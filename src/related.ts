// Self-building keyword retrieval: no preset lexicon — terms are mined from the
// corpus itself (TF-IDF over tokens + CJK n-grams) and expanded iteratively:
// search → mine new terms from top hits → merge into query → search again.
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STOP = new Set([
  // en
  'the','a','an','and','or','of','to','in','on','for','with','by','at','from','as','is','are','was','were','be','been','being','it','its','this','that','these','those','we','our','you','your','they','their','he','she','him','her','i','my','me','not','no','but','if','then','than','so','such','which','who','whom','what','when','where','why','how','all','any','both','each','few','more','most','other','some','can','could','may','might','must','shall','should','will','would','do','does','did','has','have','had','about','into','over','under','again','further','once','only','own','same','too','very','just','also','per','via',
  // zh
  '的','了','和','是','在','有','与','就','都','而','及','或','一个','我们','你们','他们','这个','那个','这些','那些','不','没有','可以','能够','应该','但是','因为','所以','如果','那么','如何','什么','为什么','怎么','中','上','下','里','对','为','于','之','其','被','把','让','向','从','到','等','等','以及','其中','以及','分别','主要','相关','基于','进行','使用','通过','对于','关于','不是','就是','还是','以及'
]);

export interface RelatedDoc { id: number; title: string; body: string; source: string; added: string; }
export interface KeywordHit { term: string; score: number; freq: number; docs: number; last_seen: string; }

function dbPath(project: string): string {
  return path.join(project, '.rlab', 'related.db');
}

export function openDb(project: string): DatabaseSync {
  const dir = path.dirname(dbPath(project));
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath(project));
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT DEFAULT '',
      added TEXT DEFAULT (date('now'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, body, content='docs', content_rowid='id');
    CREATE TABLE IF NOT EXISTS keywords (
      term TEXT PRIMARY KEY,
      score REAL NOT NULL DEFAULT 0,
      freq INTEGER NOT NULL DEFAULT 0,
      docs INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT DEFAULT (date('now'))
    );
    CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
      INSERT INTO docs_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
      INSERT INTO docs_fts(docs_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body);
    END;
    -- Absorb ledger. Without it rlab_absorb re-read the FIRST max files of a directory on every call:
    -- there was no cursor, no skip and no dedupe, so a second call re-did the same work and reported
    -- "0 skipped" every time, and the docs table gained a duplicate row per call. 'key' is the cheap
    -- change detector (size:mtimeMs) so an unchanged file is skipped without reading it at all.
    CREATE TABLE IF NOT EXISTS absorbed (
      path TEXT PRIMARY KEY,
      key TEXT NOT NULL DEFAULT '',
      doc_id INTEGER,
      page TEXT,
      ts TEXT DEFAULT (date('now'))
    );
  `);
  return db;
}

// ---- tokenization (zero-dep NLP) ----
const CJK = /[\u4e00-\u9fff]/;
const isCJKChar = (c: string) => CJK.test(c);

export function tokenize(text: string): string[] {
  const toks: string[] = [];
  // latin words
  const latin = text.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) || [];
  toks.push(...latin);
  // CJK: slide 2-grams over contiguous hanzi runs (no preset lexicon)
  const hanzi = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of hanzi) {
    const chars = [...run];
    for (let i = 0; i < chars.length - 1; i++) {
      const bigram = chars[i] + chars[i + 1];
      if (i + 2 < chars.length) {
        toks.push(chars[i] + chars[i + 1] + chars[i + 2]); // trigram too
      }
      toks.push(bigram);
    }
  }
  return toks.filter(t => !STOP.has(t) && t.length > 1);
}

// text prepared for FTS5: latin words + CJK n-grams space-joined so unicode61 can match
export function ftsText(text: string): string {
  return tokenize(text).join(' ');
}

// ---- keyword mining (TF-IDF over the corpus) ----
export function mineKeywords(project: string, topN = 40): KeywordHit[] {
  const db = openDb(project);
  const n = (db.prepare('SELECT COUNT(*) c FROM docs').get() as { c: number }).c;
  if (!n) return [];
  const rows = db.prepare('SELECT id, title, body FROM docs').all() as { id: number; title: string; body: string }[];
  const df = new Map<string, number>();
  const tf = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const toks = [...new Set(tokenize(r.title + ' ' + r.body))];
    const seen = new Set<string>();
    const all = tokenize(r.title + ' ' + r.title + ' ' + r.body); // title weighted ×2
    for (const t of all) {
      if (!tf.has(t)) tf.set(t, new Map());
      const m = tf.get(t)!;
      m.set(r.id, (m.get(r.id) || 0) + 1);
      if (!seen.has(t)) { seen.add(t); df.set(t, (df.get(t) || 0) + 1); }
    }
  }
  const idf = (t: string) => Math.log(1 + n / (1 + (df.get(t) || 0)));
  const scored: KeywordHit[] = [];
  for (const [t, perDoc] of tf) {
    let freq = 0;
    for (const f of perDoc.values()) freq += f;
    const score = (freq / Math.max(1, perDoc.size)) * idf(t);
    scored.push({ term: t, score, freq, docs: perDoc.size, last_seen: '' });
  }
  scored.sort((a, b) => b.score - a.score);
  // upsert into keywords table (persistent auto-built lexicon)
  const upsert = db.prepare(`INSERT INTO keywords(term, score, freq, docs) VALUES (?,?,?,?)
    ON CONFLICT(term) DO UPDATE SET score=excluded.score, freq=excluded.freq, docs=excluded.docs, last_seen=date('now')`);
  for (const k of scored.slice(0, topN * 3)) upsert.run(k.term, k.score, k.freq, k.docs);
  return scored.slice(0, topN);
}

// ---- FTS5 search ----
export function search(project: string, query: string, k = 10): RelatedDoc[] {
  const db = openDb(project);
  const q = ftsText(query).split(' ').filter(Boolean).slice(0, 12).map(t => '"' + t + '"').join(' OR ');
  if (!q) return [];
  const rows = db.prepare(`
    SELECT d.id, d.title, d.body, d.source, d.added, bm25(docs_fts) AS rank
    FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
    WHERE docs_fts MATCH ?
    ORDER BY rank LIMIT ?
  `).all(q, k) as unknown as (RelatedDoc & { rank: number })[];
  return rows;
}


// ---- BM25 + RRF hybrid (ported from w8-core/src/retrieval.ts, Okapi 1994 + RRF) ----
function bm25Scores(query: string, docs: { id: number; text: string }[], k1 = 1.5, b = 0.75): Map<number, number> {
  const scores = new Map<number, number>();
  const qt = new Set(tokenize(query));
  if (!qt.size || !docs.length) return scores;
  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.text.length, 0) / N;
  const df = new Map<string, number>();
  const docToks = docs.map(d => {
    const toks = tokenize(d.text);
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
    return toks;
  });
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    let s = 0;
    const tf = new Map<string, number>();
    for (const t of docToks[i]) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of qt) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      const denom = f + k1 * (1 - b + b * (d.text.length / avgdl));
      s += idf * ((f * (k1 + 1)) / denom);
    }
    if (s > 0) scores.set(d.id, s);
  }
  return scores;
}

function rrfFuse(lists: (number | string)[][], k = 60): Map<string | number, number> {
  const fused = new Map<string | number, number>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      fused.set(id, (fused.get(id) || 0) + 1 / (k + i + 1));
    }
  }
  return fused;
}

export function hybridSearch(project: string, query: string, k = 10): RelatedDoc[] {
  const db = openDb(project);
  const rows = db.prepare('SELECT id, title, body, source, added FROM docs').all() as unknown as RelatedDoc[];
  if (!rows.length) return [];
  // path 1: FTS5
  const fts = search(project, query, k * 2).map(d => d.id);
  // path 2: BM25 over raw text (finer CJK granularity than FTS5 unicode61)
  const bm = bm25Scores(query, rows.map(d => ({ id: d.id, text: d.title + ' ' + d.body })));
  const bmIds = [...bm.entries()].sort((a, b) => b[1] - a[1]).slice(0, k * 2).map(([id]) => id);
  // fuse with RRF
  const fused = rrfFuse([fts, bmIds], 60);
  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => Number(id));
  const byId = new Map(rows.map(d => [d.id, d]));
  return ranked.map(id => byId.get(id)).filter((d): d is RelatedDoc => !!d);
}

/** One ledger row: the cheap change key and the doc/page it produced. */
export interface AbsorbRow { path: string; key: string; doc_id: number | null; page: string | null }

/** The absorb ledger for a project, keyed by project-relative path. */
export function absorbLedger(project: string): Map<string, AbsorbRow> {
  const db = openDb(project);
  const rows = db.prepare('SELECT path, key, doc_id, page FROM absorbed').all() as unknown as AbsorbRow[];
  return new Map(rows.map((r) => [r.path, r]));
}

/** Record a file as absorbed (upsert — the path is the identity, the key is its content state). */
export function recordAbsorbed(project: string, row: { path: string; key: string; docId?: number | null; page?: string | null }): void {
  const db = openDb(project);
  db.prepare(`INSERT INTO absorbed(path, key, doc_id, page, ts) VALUES (?,?,?,?,date('now'))
    ON CONFLICT(path) DO UPDATE SET key=excluded.key, doc_id=excluded.doc_id, page=excluded.page, ts=excluded.ts`)
    .run(row.path, row.key, row.docId ?? null, row.page ?? null);
}

/**
 * Replace an existing indexed document in place. A report that CHANGED must not become a second row:
 * the old code inserted on every absorb, so one edited file appeared in the corpus as many times as
 * it was absorbed.
 */
export function updateDoc(project: string, id: number, title: string, body: string, source: string, opts: { refreshLexicon?: boolean } = {}): boolean {
  const db = openDb(project);
  const safeTitle = typeof title === 'string' && title.trim().length > 0 ? title : '(untitled)';
  const before = db.prepare('SELECT title, body FROM docs WHERE id=?').get(id) as { title: string; body: string } | undefined;
  if (before === undefined) return false;
  // The FTS table is external-content: its row has to be re-synced explicitly around the update.
  db.prepare("INSERT INTO docs_fts(docs_fts, rowid, title, body) VALUES('delete', ?, ?, ?)").run(id, before.title, before.body);
  db.prepare('UPDATE docs SET title=?, body=?, source=?, added=date(\'now\') WHERE id=?')
    .run(safeTitle, ftsText(safeTitle + ' ' + (typeof body === 'string' ? body : '')), source, id);
  db.prepare('INSERT INTO docs_fts(rowid, title, body) VALUES (?,?,?)').run(id, safeTitle, ftsText(safeTitle + ' ' + (typeof body === 'string' ? body : '')));
  if (opts.refreshLexicon !== false) mineKeywords(project, 40);
  return true;
}

export function addDoc(project: string, title: string, body: string, source: string, opts: { refreshLexicon?: boolean } = {}): number {
  const db = openDb(project);
  // Values arrive from tools, from directory ingest and from tests. An omitted field used
  // to reach SQLite as `undefined` ("Provided value cannot be bound to SQLite parameter 1")
  // and a null title tripped the NOT NULL constraint - the same undefined-binding defect
  // class that silently killed auto-capture elsewhere in this stack. Normalise, and never
  // store an empty title (an untitled document is still a document).
  const safeTitle = typeof title === 'string' && title.trim().length > 0 ? title : '(untitled)';
  const safeBody = typeof body === 'string' ? body : '';
  const safeSource = typeof source === 'string' ? source : '';
  const r = db.prepare('INSERT INTO docs(title, body, source) VALUES (?,?,?)')
    .run(safeTitle, ftsText(safeTitle + ' ' + safeBody), safeSource);
  // Refreshing here is right for ONE document and catastrophic for a batch: mineKeywords re-reads and
  // re-tokenizes the entire corpus, so an N-file ingest used to pay O(N^2) tokenization (124 files was
  // enough to hang the host). Batch callers pass refreshLexicon:false and refresh ONCE at the end.
  if (opts.refreshLexicon !== false) mineKeywords(project, 40);
  return Number(r.lastInsertRowid);
}

// Bulk-ingest .md files from a directory (e.g. .dsh-lib-analyzer/pages, batch/out, w8/ref) —
// interoperability with dsh-lib-analyzer knowledge pages and absorption reports.
export interface IngestOpts { max?: number; budgetMs?: number; ledgerPrefix?: string }
export interface IngestResult { found: number; added: number; updated: number; skipped: number; unchanged: number; remaining: number }

/**
 * Bulk-ingest .md files from a directory, RESUMABLY.
 *
 * Two defects made this the tool that hung the host: it had no ledger (every call re-read and
 * re-inserted the same files, so a second identical call was pure repeated work), and it had no bound
 * (maxFiles defaulted to 200 and the loop ran to completion synchronously). The third one was hidden
 * inside addDoc: every insert rebuilt the corpus-wide TF-IDF lexicon, so an N-file ingest paid O(N^2)
 * tokenization. Now: files are keyed by size:mtime in the absorb ledger, at most `max` are written per
 * call inside a `budgetMs` window, and the lexicon is refreshed ONCE at the end.
 *
 * The caller is still responsible for yielding to the event loop between calls (the tool does it per
 * chunk); this function stays synchronous so the fuzz suite can drive it directly.
 */
export function ingestDocDir(project: string, dir: string, opts: number | IngestOpts = {}): IngestResult {
  const o: IngestOpts = typeof opts === 'number' ? { max: opts } : (opts ?? {});
  const max = Math.max(1, Number(o.max) || 200);
  const budgetMs = Math.max(50, Number(o.budgetMs) || 4000);
  const prefix = o.ledgerPrefix ?? 'ingest:';
  const empty: IngestResult = { found: 0, added: 0, updated: 0, skipped: 0, unchanged: 0, remaining: 0 };
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return empty;
  // A FILE where a directory is expected (or a path that vanished between the existsSync
  // and the stat) used to throw ENOTDIR straight out of the tool. Report a shaped result.
  let isDirectory = false;
  try { isDirectory = fs.statSync(root).isDirectory(); } catch { isDirectory = false; }
  if (!isDirectory) return empty;

  // Collect first (names + stat only), so `remaining` is a real number rather than a guess.
  const files: { full: string; rel: string; key: string; mtimeMs: number }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[] = [];
    // Unreadable or concurrently removed directories end this branch, they do not abort the ingest.
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const f of entries) {
      if (f.name.startsWith('.')) continue;
      const full = path.join(d, f.name);
      if (f.isDirectory()) { walk(full, depth + 1); continue; }
      if (!f.name.endsWith('.md') && !f.name.endsWith('.mdx')) continue;
      let st: fs.Stats;
      try { st = fs.statSync(full); } catch { continue; }
      files.push({ full, rel: path.relative(root, full), key: st.size + ':' + Math.round(st.mtimeMs), mtimeMs: st.mtimeMs });
    }
  };
  walk(root, 0);

  const ledger = absorbLedger(project);
  const pending = files
    .filter((f) => ledger.get(prefix + f.rel)?.key !== f.key)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);   // newest first: a fresh page never queues behind a backlog
  const started = Date.now();
  let added = 0, updated = 0, skipped = 0;
  for (const f of pending) {
    if (added + updated >= max) break;
    if (Date.now() - started > budgetMs) break;
    try {
      // .toWellFormed(): see the note in index.ts — a slice can split a surrogate pair.
      const text = fs.readFileSync(f.full, 'utf8').slice(0, 20000).toWellFormed();
      const before = ledger.get(prefix + f.rel);
      let docId: number | null = null;
      if (before?.doc_id != null && updateDoc(project, before.doc_id, f.rel, text, 'ingest:' + path.basename(root), { refreshLexicon: false })) {
        docId = before.doc_id; updated++;
      } else {
        docId = addDoc(project, f.rel, text, 'ingest:' + path.basename(root), { refreshLexicon: false }); added++;
      }
      recordAbsorbed(project, { path: prefix + f.rel, key: f.key, docId, page: null });
    } catch { skipped++; }
  }
  // ONE refresh for the batch. Per document it was corpus-wide work, i.e. quadratic in the batch size.
  if (added + updated > 0) mineKeywords(project, 40);
  return {
    found: files.length,
    added, updated, skipped,
    unchanged: files.length - pending.length,
    remaining: Math.max(0, pending.length - added - updated - skipped),
  };
}

export function topKeywords(project: string, topN = 30): KeywordHit[] {
  const db = openDb(project);
  return db.prepare('SELECT term, score, freq, docs FROM keywords ORDER BY score DESC LIMIT ?')
    .all(topN) as unknown as KeywordHit[];
}

// ---- iterative expansion: search → mine → merge → search ----
export function expandSearch(project: string, seed: string, rounds = 2, k = 8): {
  rounds: { round: number; newTerms: string[]; hits: RelatedDoc[] }[];
  final: RelatedDoc[];
  lexicon: KeywordHit[];
} {
  const db = openDb(project);
  let query = seed;
  const seenTerms = new Set<string>(tokenize(seed));
  const report: { round: number; newTerms: string[]; hits: RelatedDoc[] }[] = [];
  let final: RelatedDoc[] = [];
  for (let r = 1; r <= rounds; r++) {
    const hits = hybridSearch(project, query, k);
    final = hits;
    // mine new terms from this round's top hits (title+body, weighted)
    const toks = new Map<string, number>();
    for (const h of hits) {
      const t = tokenize(h.title + ' ' + h.title + ' ' + h.body.slice(0, 2000).toWellFormed());
      for (const x of t) toks.set(x, (toks.get(x) || 0) + 1);
    }
    const newTerms = [...toks.entries()]
      .filter(([t]) => !seenTerms.has(t))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);
    report.push({ round: r, newTerms, hits });
    if (!newTerms.length) break; // lexicon saturated
    for (const t of newTerms) seenTerms.add(t);
    query = [query, ...newTerms].join(' OR ');
  }
  return { rounds: report, final, lexicon: topKeywords(project, 30) };
}