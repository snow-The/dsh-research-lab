// Storage layer for dsh-research-lab: <project>/.rlab/ with path-safety guards.
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RLAB_DIR = '.rlab';

export function rlabDir(project: string): string {
  const abs = path.resolve(project);
  return path.join(abs, RLAB_DIR);
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------- append-only primitives (the multi-writer write path) ----------
//
// WHY THIS EXISTS: a ledger written by "read the file, change it, write the whole file back" is a
// single-writer design. Two agents doing that at the same time each write a copy of the state they
// read, and the later rename silently deletes the other agent's record. The only write primitive a
// shared ledger is allowed to use here is therefore: ONE self-contained JSON record, ONE append.
//
// ATOMICITY ASSUMPTION — and its exact boundary:
//  - POSIX: the file is opened with O_APPEND, so "seek to end + write" is a single atomic step for
//    the kernel; two processes appending a small buffer do not interleave bytes inside a line.
//  - Windows: Node appends through a handle opened in append mode and issues ONE WriteFile for a
//    small buffer, so the same holds up to the boundary below.
//  - BOUNDARY: a single record (its JSON bytes PLUS the trailing newline) MUST be <= 4096 bytes
//    (MAX_APPEND_RECORD_BYTES). Above that, Node and/or the filesystem may split one append into
//    several write(2)/WriteFile calls, and two writers can then interleave bytes INSIDE one line.
//    appendJsonLine() therefore REFUSES an oversized record (AppendRecordTooLargeError, code
//    APPEND_RECORD_TOO_LARGE) instead of truncating it. A caller that legitimately has more bytes
//    (a wiki page body) must split the record first — see buildWikiHistoryLines().
//  - NOT covered: NFS/SMB/iCloud-style network filesystems, where O_APPEND is not atomic across
//    clients. Keep .rlab on a local disk when several agents write it.
//  - Crash safety: a process killed mid-append can leave a torn last line. Every reader here parses
//    line by line and skips an unparsable line (readJsonLines), so a torn tail cannot poison the
//    ledger, and the next append still starts on a fresh line.
//  - No sequence number is allocated. A per-file monotonic `seq` cannot be computed without
//    coordination: "current line count + 1" or "max(seq) + 1" makes two writers mint the same
//    number, and the only fix is an exclusive lock around every append. `owner` + `recordedAt`
//    (ISO) identifies a record and orders it well enough for a ledger, so append stays lock-free.
export const MAX_APPEND_RECORD_BYTES = 4096;

export class AppendRecordTooLargeError extends Error {
  readonly code = 'APPEND_RECORD_TOO_LARGE';
  readonly file: string;
  readonly bytes: number;
  readonly limit: number;
  constructor(file: string, bytes: number, label = 'record') {
    super(label + ' is ' + bytes + ' bytes (JSON + newline), above the ' + MAX_APPEND_RECORD_BYTES +
      '-byte atomic-append boundary for ' + file + '. Refusing to write: split it into several ' +
      'records first (never truncated silently).');
    this.name = 'AppendRecordTooLargeError';
    this.file = file;
    this.bytes = bytes;
    this.limit = MAX_APPEND_RECORD_BYTES;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** The caller's session/agent id; 'unknown' when it did not supply one. Never invents an owner. */
export function ownerOf(owner: unknown): string {
  const s = typeof owner === 'string' ? owner.trim() : '';
  return s ? s.slice(0, 120) : 'unknown';
}

/** sha256 of a raw JSON line, first 16 hex chars — the value a superseding record points at. */
export function lineFingerprint(rawLine: string): string {
  return createHash('sha256').update(rawLine, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Identity of a version whose body may be split across several lines: sha256(at \0 owner \0 body).
 * Computing it from the reassembled parts (not from a line) is what lets a chunked record still be
 * superseded by a later one.
 */
export function entryFingerprint(at: string, owner: string, body: string): string {
  return lineFingerprint(at + '\u0000' + owner + '\u0000' + body);
}

/** Read a JSONL file tolerantly: a torn/foreign line is skipped, never fatal. Keeps line order. */
export function readJsonLines(file: string): { raw: string; value: any }[] {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out: { raw: string; value: any }[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === 'object') out.push({ raw, value });
    } catch { /* torn or foreign line — skip it; the ledger is judged line by line */ }
  }
  return out;
}

/** One append, one record. This is the atomic unit; never batch records into a larger buffer. */
export function appendJsonLine(file: string, record: unknown, label = 'record'): string {
  const raw = JSON.stringify(record);
  const bytes = Buffer.byteLength(raw, 'utf8') + 1;   // + the newline that ends the record
  if (bytes > MAX_APPEND_RECORD_BYTES) throw new AppendRecordTooLargeError(file, bytes, label);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, raw + '\n', { encoding: 'utf8' });
  return raw;
}

// ---------- wiki pages ----------
export type WikiKind = 'experiment' | 'literature' | 'decision' | 'todo';
export interface WikiPage {
  kind: WikiKind;
  id: string;
  title: string;
  updated: string;
  content: string;
  tags?: string[];
  /** session/agent id of the writer; recorded in the page history, defaults to 'unknown'. */
  owner?: string;
}

const WIKI_DIR = 'wiki';

// OmegaWiki frontmatter: --- block of key: value lines (shared contract with rlab_validate)
export function parseFrontmatter(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!mm) continue;
    const key = mm[1];
    const val = mm[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function wikiPath(project: string, kind: WikiKind, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(rlabDir(project), WIKI_DIR, kind, safe + '.md');
}

/** The append-only version ledger of one page: one JSON record per write, never rewritten. */
export function wikiHistoryPath(project: string, kind: WikiKind, id: string): string {
  return wikiPath(project, kind, id).replace(/\.md$/, '') + '.history.jsonl';
}

export interface WikiHistoryEntry {
  at: string;
  owner: string;
  supersedes?: string;
  /** the exact page text (frontmatter + title + body) written at this version */
  body: string;
  /** entryFingerprint(at, owner, body) — the value a later version puts in `supersedes` */
  fingerprint: string;
  chunks: number;
  /** true when a LATER version replaced this one; the record itself is never deleted */
  superseded: boolean;
}

/**
 * Split a body so that every produced JSON line stays under the atomic-append bound.
 * Iterates code points, so a surrogate pair is never cut in half. The JSON escaping overhead is
 * unknown before serialising, so the byte budget halves until every produced line fits.
 */
function splitBodyByBytes(body: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of body) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (cur && curBytes + b > maxBytes) { chunks.push(cur); cur = ''; curBytes = 0; }
    cur += ch;
    curBytes += b;
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [''];
}

function buildWikiHistoryLines(meta: { at: string; owner: string; supersedes?: string }, body: string): Record<string, unknown>[] {
  const base: Record<string, unknown> = { at: meta.at, owner: meta.owner };
  if (meta.supersedes) base.supersedes = meta.supersedes;
  const single: Record<string, unknown> = { ...base, body };
  if (Buffer.byteLength(JSON.stringify(single), 'utf8') + 1 <= MAX_APPEND_RECORD_BYTES) return [single];
  // The body alone can exceed one atomic append. Split it: every line carries the entry id and its
  // position, so the version is reassembled correctly even if another writer's lines land between.
  const entry = entryFingerprint(meta.at, meta.owner, body);
  let budget = Math.floor(MAX_APPEND_RECORD_BYTES / 2);
  for (let attempt = 0; attempt < 12; attempt++) {
    const parts = splitBodyByBytes(body, Math.max(1, budget));
    const lines = parts.map((part, i) => ({ ...base, entry, chunk: i, chunks: parts.length, body: part }));
    if (lines.every(l => Buffer.byteLength(JSON.stringify(l), 'utf8') + 1 <= MAX_APPEND_RECORD_BYTES)) return lines;
    budget = Math.floor(budget / 2);
  }
  throw new Error('wiki history body could not be split under ' + MAX_APPEND_RECORD_BYTES + ' bytes');
}

function appendWikiHistory(project: string, kind: WikiKind, id: string, body: string, owner: string): void {
  const file = wikiHistoryPath(project, kind, id);
  const previous = readWikiHistory(project, kind, id);
  const at = nowIso();
  const meta = { at, owner, supersedes: previous.length ? previous[previous.length - 1].fingerprint : undefined };
  for (const line of buildWikiHistoryLines(meta, body)) {
    appendJsonLine(file, line, 'wiki history entry for ' + kind + ':' + id);
  }
}

/** Read the version ledger of one page, in write order. Superseded versions stay readable. */
export function readWikiHistory(project: string, kind: WikiKind, id: string): WikiHistoryEntry[] {
  const file = wikiHistoryPath(project, kind, id);
  const entries: { order: number; at: string; owner: string; supersedes?: string; body: string; chunks: number }[] = [];
  const groups = new Map<string, { order: number; at: string; owner: string; supersedes?: string; total: number; parts: Map<number, string> }>();
  let order = 0;
  for (const { value: rec } of readJsonLines(file)) {
    if (typeof rec.body !== 'string' || typeof rec.at !== 'string') continue;
    const owner = ownerOf(rec.owner);
    const supersedes = typeof rec.supersedes === 'string' && rec.supersedes ? rec.supersedes : undefined;
    if (typeof rec.chunk === 'number' && typeof rec.chunks === 'number' && typeof rec.entry === 'string') {
      const g = groups.get(rec.entry) ?? { order: order++, at: rec.at, owner, supersedes, total: rec.chunks, parts: new Map<number, string>() };
      g.parts.set(rec.chunk, rec.body);
      groups.set(rec.entry, g);
      continue;
    }
    entries.push({ order: order++, at: rec.at, owner, supersedes, body: rec.body, chunks: 1 });
  }
  for (const g of groups.values()) {
    if (g.parts.size !== g.total) continue;   // crash between chunks: skip the incomplete version
    let body = '';
    for (let i = 0; i < g.total; i++) body += g.parts.get(i) ?? '';
    entries.push({ order: g.order, at: g.at, owner: g.owner, supersedes: g.supersedes, body, chunks: g.total });
  }
  entries.sort((a, b) => a.order - b.order);
  const withFp = entries.map(e => ({ ...e, fingerprint: entryFingerprint(e.at, e.owner, e.body) }));
  // A version is hidden only when a LATER version names it. The rule is one-directional (j < i), so
  // a duplicate or a malformed forward reference can never erase a record.
  const indicesByFingerprint = new Map<string, number[]>();
  withFp.forEach((e, i) => {
    const arr = indicesByFingerprint.get(e.fingerprint);
    if (arr) arr.push(i); else indicesByFingerprint.set(e.fingerprint, [i]);
  });
  const hidden = withFp.map(() => false);
  withFp.forEach((e, i) => {
    if (!e.supersedes) return;
    for (const j of indicesByFingerprint.get(e.supersedes) ?? []) if (j < i) hidden[j] = true;
  });
  return withFp.map((e, i) => ({ at: e.at, owner: e.owner, supersedes: e.supersedes, body: e.body, fingerprint: e.fingerprint, chunks: e.chunks, superseded: hidden[i] }));
}

/**
 * Replace `to` with `from` atomically, tolerating the Windows sharing race.
 *
 * Two writers finishing a page at the same time both rename onto the same destination. On Windows a
 * rename that replaces a file another process is momentarily renaming/opening can fail with
 * EPERM/EACCES/EBUSY (the destination is opened without FILE_SHARE_DELETE). The source file is
 * already complete, so retrying the same rename is safe and converges within a few milliseconds.
 */
function renameWithRetry(from: string, to: string, attempts = 12): void {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e: any) {
      last = e;
      const code = String(e?.code ?? '');
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3 + i * 3);
    }
  }
  try { fs.unlinkSync(from); } catch { /* best effort */ }
  throw last;
}

export function writeWikiPage(project: string, page: WikiPage): string {
  const p = wikiPath(project, page.kind, page.id);
  const fm = [
    '---',
    'id: ' + page.id,
    'kind: ' + page.kind,
    'title: ' + page.title.replace(/\n/g, ' '),
    'updated: ' + page.updated,
    (page.tags?.length ? 'tags: [' + page.tags.join(', ') + ']' : 'tags: []'),
    '---',
    '',
  ].join('\n');
  const body = [
    fm,
    '# ' + page.title,
    '',
    page.content.trim(),
    '',
  ].join('\n');
  ensureDir(path.dirname(p));
  // 1) History first: the ledger is the source of truth. If this process dies before the rename
  //    below, the visible page is at worst one version behind — never a page no record explains.
  appendWikiHistory(project, page.kind, page.id, body, ownerOf(page.owner));
  // 2) <page>.md is the PROJECTION of the latest version, not the ledger. Two writers can still race
  //    for "who is latest" (last rename wins), but no write is lost: both are in the history above.
  //    Atomic tmp+rename, per-process tmp name so two writers cannot delete each other's temp file.
  const tmp = p + '.' + process.pid + '.' + randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, body, 'utf8');
  renameWithRetry(tmp, p);
  // append-only operation log (AutoSci hard rule: wiki/log.md never rewritten in place)
  const log = path.join(rlabDir(project), 'wiki', 'log.md');
  const stamp = nowIso();
  fs.appendFileSync(log, '- ' + stamp + '  ' + page.kind + ':' + page.id + '  ' + page.title.replace(/[\r\n]+/g, ' ') + '\n', 'utf8');
  return p;
}

export function listWiki(project: string): WikiPage[] {
  const root = path.join(rlabDir(project), WIKI_DIR);
  const pages: WikiPage[] = [];
  const kinds: WikiKind[] = ['experiment', 'literature', 'decision', 'todo'];
  for (const kind of kinds) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const full = path.join(dir, f);
      const text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      const title = String(fm.title || (text.match(/^# (.+)$/m) || [])[1] || f.replace(/\.md$/, ''));
      const updated = String(fm.updated || '');
      const tags: string[] = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [String(fm.tags)] : []);
      pages.push({ kind, id: f.replace(/\.md$/, ''), title, updated, tags, content: '' });
    }
  }
  return pages.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export function rebuildWikiIndex(project: string): string {
  const pages = listWiki(project);
  const lines = ['# Research Wiki Index', '', 'Auto-generated by dsh-research-lab. Do not edit by hand.', ''];
  const kinds: { k: WikiKind; label: string }[] = [
    { k: 'experiment', label: '## Experiments' },
    { k: 'literature', label: '## Literature' },
    { k: 'decision', label: '## Decisions' },
    { k: 'todo', label: '## TODO' },
  ];
  for (const { k, label } of kinds) {
    const sub = pages.filter(p => p.kind === k);
    if (!sub.length) continue;
    lines.push(label);
    for (const p of sub) {
      lines.push('- [' + p.title + '](wiki/' + k + '/' + p.id + '.md)' + (p.updated ? '  _' + p.updated + '_' : ''));
    }
    lines.push('');
  }
  const idx = path.join(rlabDir(project), WIKI_DIR, 'index.md');
  ensureDir(path.dirname(idx));
  fs.writeFileSync(idx, lines.join('\n') + '\n', 'utf8');
  return idx;
}

// ---------- bench ledger (JSONL, one row per run) ----------
export interface BenchRow {
  date: string;
  model: string;
  task: string;
  metric: string;   // e.g. cos_sim.spearman | ndcg_at_10 | accuracy
  score: number;
  split?: string;   // test | dev | validation — CRITICAL: splits are NOT comparable
  hf_subset?: string;
  prompt_type?: string;
  seed?: number;
  note?: string;
}

export function benchFile(project: string): string {
  return path.join(rlabDir(project), 'bench.jsonl');
}

export function appendBench(project: string, row: BenchRow): BenchRow[] {
  const file = benchFile(project);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8');
  return readBench(project);
}

export function readBench(project: string): BenchRow[] {
  const file = benchFile(project);
  if (!fs.existsSync(file)) return [];
  const rows: BenchRow[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as BenchRow); } catch { /* skip bad line */ }
  }
  return rows;
}

export function benchReport(project: string, model?: string, task?: string): string {
  let rows = readBench(project);
  if (!rows.length) return 'No benchmark rows yet for ' + project + '. Add one with rlab_bench.';
  if (model) rows = rows.filter(r => r.model.toLowerCase().includes(model.toLowerCase()));
  if (task) rows = rows.filter(r => r.task.toLowerCase().includes(task.toLowerCase()));
  if (!rows.length) return 'No rows match the filter.';
  const lines = ['# Bench ledger — ' + project, ''];
  // group by task
  const byTask = new Map<string, BenchRow[]>();
  for (const r of rows) {
    const arr = byTask.get(r.task) || [];
    arr.push(r);
    byTask.set(r.task, arr);
  }
  for (const [t, rs] of [...byTask.entries()].sort()) {
    lines.push('## ' + t + '  (' + rs.length + ' runs)');
    const byModel = new Map<string, BenchRow[]>();
    for (const r of rs) {
      const arr = byModel.get(r.model) || [];
      arr.push(r);
      byModel.set(r.model, arr);
    }
    for (const [m, mr] of [...byModel.entries()].sort()) {
      const latest = mr[mr.length - 1];
      const all = mr.map(r => r.score.toFixed(4)).join(' → ');
      lines.push('- **' + m + '**  latest=' + latest.score.toFixed(4) + ' (' + latest.metric + ')  history=[' + all + ']');
      if (latest.split) lines.push('  - split=' + latest.split + (latest.hf_subset ? ' subset=' + latest.hf_subset : '') + '  ' + latest.date + (latest.note ? '  — ' + latest.note : ''));
    }
    //口径 warning: different splits compared?
    const splits = new Set(rs.map(r => r.split || '?'));
    if (splits.size > 1) {
      lines.push('  ⚠️ **口径不一致**: runs use different splits (' + [...splits].join(', ') + ') — do NOT compare across splits.');
    }
    lines.push('');
  }
  lines.push('_Ledger: ' + benchFile(project) + '_');
  return lines.join('\n');
}