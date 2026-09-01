// Claim extraction + evidence confidence (beta posterior).
//  - extract: regex templates pull "we propose X / achieves Y on Z / outperforms W by V"
//    claims from paper text (zh + en) — pattern.ts spirit, but template-based.
//  - confidence: beta posterior with prior weight (w8-core betaConfidence port).
// Claims persist in <project>/.rlab/claims.jsonl for an evidence ledger.
import * as fs from 'node:fs';
import * as path from 'node:path';

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

export function loadClaims(project: string): Claim[] {
  try {
    const lines = fs.readFileSync(claimsFile(project), 'utf8').split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l) as Claim);
  } catch { return []; }
}

export function addClaims(project: string, docId: number, text: string): Claim[] {
  const existing = loadClaims(project);
  let nextId = existing.length ? Math.max(...existing.map(c => c.id)) + 1 : 1;
  const fresh = extractClaims(text);
  const prior = 0.5;
  const added: Claim[] = [];
  fs.mkdirSync(path.dirname(claimsFile(project)), { recursive: true });
  for (const c of fresh) {
    const claim: Claim = { id: nextId++, docId, ...c, cited: 0, confidence: betaConfidence(prior, 0), date: new Date().toISOString().slice(0, 10) };
    fs.appendFileSync(claimsFile(project), JSON.stringify(claim) + '\n', 'utf8');
    added.push(claim);
  }
  return added;
}

export function citeClaim(project: string, claimId: number, weight = 100): Claim | null {
  const claims = loadClaims(project);
  const c = claims.find(x => x.id === claimId);
  if (!c) return null;
  c.cited += 1;
  c.confidence = betaConfidence(0.5, c.cited, weight);
  fs.writeFileSync(claimsFile(project), claims.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  return c;
}

export function claimsReport(project: string, type?: string): string {
  const claims = loadClaims(project);
  if (!claims.length) return 'No claims recorded yet. Use rlab_claim action=extract.';
  const rows = type ? claims.filter(c => c.type === type) : claims;
  const lines = ['# Claim ledger — ' + project + ' (' + rows.length + ' claims)', ''];
  for (const c of rows) {
    lines.push('[' + c.id + '] ' + c.type.toUpperCase() + '  conf=' + c.confidence.toFixed(3) + ' cited=' + c.cited);
    if (c.subject) lines.push('  subject: ' + c.subject);
    if (c.value) lines.push('  value: ' + c.value + (c.task ? '  on: ' + c.task : ''));
    lines.push('  ctx: "' + c.context.slice(0, 140) + '"');
    lines.push('');
  }
  return lines.join('\n');
}