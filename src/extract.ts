// Claim extraction + evidence confidence (beta posterior).
//  - extract: regex templates pull "we propose X / achieves Y on Z / outperforms W by V"
//    claims from paper text (zh + en) — pattern.ts spirit, but template-based.
//  - confidence: beta posterior with prior weight (w8-core betaConfidence port).
// Claims persist in <project>/.rlab/claims.jsonl as an APPEND-ONLY ledger: one claim per line, one
// append per claim, never a whole-file rewrite. Several agents may extract/cite at the same time and
// nobody's record is overwritten — see store.ts for the atomic-append contract and its 4 KB bound.
import * as path from 'node:path';
import { appendJsonLine, lineFingerprint, nowIso, ownerOf, readJsonLines } from './store.js';

export interface Claim {
  id: number;
  docId: number;
  type: 'contribution' | 'result' | 'comparison';
  subject: string;
  value?: string;
  task?: string;
  context: string;
  cited: number;
  confidence: number;
  date: string;
}

/**
 * One line of claims.jsonl. `owner` + `recordedAt` identify the writer and order the record.
 *
 * There is deliberately NO sequence number. A per-file monotonic `seq` cannot be allocated without
 * coordination: both "line count + 1" and "max(seq in file) + 1" let two parallel writers mint the
 * same number, and the only fix is an exclusive lock around every append. Ordering is a read-time
 * concern and needs no coordination at all, so the append path stays lock-free.
 */
export interface ClaimRecord extends Claim {
  owner: string;
  recordedAt: string;
  /** fingerprint (sha256[:16] of the replaced line) this record replaces; the old line stays on disk */
  supersedes?: string;
  /** legacy field: old files may carry one, this writer never assigns it (see the note above) */
  seq?: number;
}

export interface LoadClaimsOptions {
  /** also return versions that a later record supersedes (default: only the live version) */
  includeSuperseded?: boolean;
}

export function betaConfidence(prior: number, cited: number, weight = 100): number {
  return (prior * weight + cited) / (weight + cited);
}

const TEMPLATES: { type: Claim['type']; re: RegExp; pick: (m: RegExpExecArray) => { subject: string; value?: string; task?: string } }[] = [
  {
    type: 'contribution',
    re: /we (propose|present|introduce|design|develop) ([A-Z][\w\s-]{3,60}?)(?:,| for| to| which| that| \.)/gi,
    pick: m => ({ subject: m[2].trim() }),
  },
  {
    type: 'contribution',
    re: /本(文|工作)(提出|设计|介绍|开发)(了)?([\u4e00-\u9fff\w\s-]{3,60}?)(?:[,。]|用于|用以|使用|使|针对|$)/gi,
    pick: m => ({ subject: (m[4] || '').trim() }),
  },
  {
    type: 'result',
    re: /(achieves|reaches|attains|obtains) ([\d.]+[%x]?) (?:on|in) ([\w\s-]{2,40}?)(?:[,.]| and | while |$)/gi,
    pick: m => ({ subject: 'result', value: m[2].trim(), task: m[3].trim() }),
  },
  {
    type: 'result',
    re: /(?:达到|获得|取得)(了)?([\d.]+[%x]?)(?:的)?(?:成绩|结果|分数|效果)?(?:在|于)?([\u4e00-\u9fff\w\s-]{2,40}?)(?:[,。]|$)/gi,
    pick: m => ({ subject: 'result', value: m[2].trim(), task: m[3].trim() }),
  },
  {
    type: 'comparison',
    re: /outperforms? ([\w\s-]{2,40}?) by ([\d.]+[%x]?)/gi,
    pick: m => ({ subject: m[1].trim(), value: m[2].trim() }),
  },
  {
    type: 'comparison',
    re: /优于([\u4e00-\u9fff\w\s-]{2,40}?)(?:约|大约)?([\d.]+[%x]?)/gi,
    pick: m => ({ subject: m[1].trim(), value: m[2].trim() }),
  },
];

export function extractClaims(text: string): Omit<Claim, 'id' | 'cited' | 'confidence' | 'date' | 'docId'>[] {
  const claims: Omit<Claim, 'id' | 'cited' | 'confidence' | 'date' | 'docId'>[] = [];
  for (const t of TEMPLATES) {
    const re = new RegExp(t.re.source, t.re.flags.includes('g') ? t.re.flags : t.re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      try {
        const p = t.pick(m);
        claims.push({ type: t.type, ...p, context: text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\s+/g, ' ').trim() });
      } catch { /* skip unparsable */ }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return claims;
}

const claimsFile = (project: string) => path.join(project, '.rlab', 'claims.jsonl');

interface ClaimLine {
  raw: string;
  record: ClaimRecord;
}

function readClaimLines(project: string): ClaimLine[] {
  const out: ClaimLine[] = [];
  for (const { raw, value } of readJsonLines(claimsFile(project))) {
    if (!value || typeof value !== 'object') continue;
    out.push({ raw, record: value as ClaimRecord });
  }
  return out;
}

/**
 * A line is superseded when a LATER line names its fingerprint in `supersedes`. The rule looks only
 * backwards (j < i), so a duplicate line, a forward reference or a foreign fingerprint can never
 * hide a record. Old files carry no `supersedes`, hence every legacy line stays visible.
 */
function supersedeMask(lines: ClaimLine[]): boolean[] {
  const live = lines.map(() => true);
  const indicesByFingerprint = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const fp = lineFingerprint(lines[i].raw);
    const arr = indicesByFingerprint.get(fp);
    if (arr) arr.push(i); else indicesByFingerprint.set(fp, [i]);
    const s = lines[i].record.supersedes;
    if (!s) continue;
    for (const j of indicesByFingerprint.get(s) ?? []) if (j < i) live[j] = false;
  }
  return live;
}

/**
 * Read the ledger. Superseded versions are filtered out by default; `includeSuperseded` returns the
 * whole history. Ordering is a READ-side concern (the file itself is never sorted): records come
 * back by id, ties broken by write order, so a parallel writer's record is never reordered away.
 */
export function loadClaims(project: string, opts: LoadClaimsOptions = {}): ClaimRecord[] {
  const lines = readClaimLines(project);
  const live = supersedeMask(lines);
  return lines
    .map((line, i) => ({ line, i }))
    .filter(({ i }) => opts.includeSuperseded === true || live[i])
    .sort((a, b) => (Number(a.line.record.id) || 0) - (Number(b.line.record.id) || 0) || a.i - b.i)
    .map(({ line }) => line.record);
}

function nextClaimId(project: string): number {
  let max = 0;
  for (const l of readClaimLines(project)) max = Math.max(max, Number(l.record.id) || 0);
  return max + 1;
}

/**
 * Append ONE claim record. This is the only writer primitive for the ledger; it never rewrites the
 * file, and a record above the 4 KB atomic-append bound throws instead of being truncated.
 *
 * `id` is a human-friendly label, NOT a key: two writers that minted the same id both keep their
 * record (the ledger is a log, not a map). A caller that intends to REPLACE a record must pass
 * `supersedes` explicitly — citeClaim() does.
 */
export function appendClaim(project: string, claim: Partial<ClaimRecord>, owner?: string): ClaimRecord {
  const recordedAt = typeof claim.recordedAt === 'string' && claim.recordedAt ? claim.recordedAt : nowIso();
  const cited = Number(claim.cited ?? 0) || 0;
  const id = Number.isFinite(Number(claim.id)) && Number(claim.id) > 0 ? Number(claim.id) : nextClaimId(project);
  const record: ClaimRecord = {
    id,
    docId: Number(claim.docId ?? 0) || 0,
    type: claim.type ?? 'contribution',
    subject: String(claim.subject ?? ''),
    ...(claim.value !== undefined ? { value: String(claim.value) } : {}),
    ...(claim.task !== undefined ? { task: String(claim.task) } : {}),
    context: String(claim.context ?? ''),
    cited,
    confidence: typeof claim.confidence === 'number' ? claim.confidence : betaConfidence(0.5, cited),
    date: typeof claim.date === 'string' && claim.date ? claim.date : recordedAt.slice(0, 10),
    owner: ownerOf(owner ?? claim.owner),
    recordedAt,
    ...(claim.supersedes ? { supersedes: String(claim.supersedes) } : {}),
  };
  appendJsonLine(claimsFile(project), record, 'claim #' + id);
  return record;
}

export function addClaims(project: string, docId: number, text: string, owner?: string): ClaimRecord[] {
  let nextId = nextClaimId(project);   // best effort: ids are hints, a collision loses nothing
  const prior = 0.5;
  const added: ClaimRecord[] = [];
  for (const c of extractClaims(text)) {
    added.push(appendClaim(project, { id: nextId++, docId, ...c, cited: 0, confidence: betaConfidence(prior, 0) }, owner));
  }
  return added;
}

/**
 * Bump a claim's citation count by APPENDING a new version that supersedes the old line.
 *
 * The honest limit of a lock-free log: two simultaneous cites can both read cited=5 and both append
 * cited=6, so the stored VALUE may lag behind the number of citation records. No record is lost —
 * read with includeSuperseded and count the versions if you need the exact number.
 */
export function citeClaim(project: string, claimId: number, weight = 100, owner?: string): ClaimRecord | null {
  const lines = readClaimLines(project);
  const live = supersedeMask(lines);
  let pick = -1;
  for (let i = 0; i < lines.length; i++) if (live[i] && Number(lines[i].record.id) === claimId) pick = i;  // newest visible wins
  if (pick < 0) return null;
  const old = lines[pick].record;
  const cited = (Number(old.cited) || 0) + 1;
  const record: ClaimRecord = {
    ...old,
    cited,
    confidence: betaConfidence(0.5, cited, weight),
    owner: ownerOf(owner),
    recordedAt: nowIso(),
    supersedes: lineFingerprint(lines[pick].raw),
  };
  appendJsonLine(claimsFile(project), record, 'cite claim #' + claimId);
  return record;
}

export function claimsReport(project: string, type?: string, opts: LoadClaimsOptions = {}): string {
  const claims = loadClaims(project, opts);
  if (!claims.length) return 'No claims recorded yet. Use rlab_claim action=extract.';
  const rows = type ? claims.filter(c => c.type === type) : claims;
  const lines = ['# Claim ledger — ' + project + ' (' + rows.length + ' claims)', ''];
  for (const c of rows) {
    lines.push('[' + c.id + '] ' + String(c.type ?? '').toUpperCase() + '  conf=' + Number(c.confidence || 0).toFixed(3) + ' cited=' + (Number(c.cited) || 0));
    if (c.subject) lines.push('  subject: ' + c.subject);
    if (c.value) lines.push('  value: ' + c.value + (c.task ? '  on: ' + c.task : ''));
    lines.push('  ctx: "' + String(c.context ?? '').slice(0, 140) + '"');
    lines.push('');
  }
  if (opts.includeSuperseded !== true) {
    const hidden = loadClaims(project, { includeSuperseded: true }).length - claims.length;
    if (hidden > 0) lines.push('_(' + hidden + ' superseded version(s) hidden — rlab_claim action=list includeSuperseded=true shows them)_', '');
  }
  return lines.join('\n');
}
