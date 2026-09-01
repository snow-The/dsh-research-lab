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

export function addDoc(project: string, title: string, body: string, source: string): number {
  const db = openDb(project);
  const r = db.prepare('INSERT INTO docs(title, body, source) VALUES (?,?,?)')
    .run(title, ftsText(title + ' ' + body), source);
  mineKeywords(project, 40); // refresh lexicon incrementally
  return Number(r.lastInsertRowid);
}

// Bulk-ingest .md files from a directory (e.g. .dsh-lib-analyzer/pages, batch/out, w8/ref) —
// interoperability with dsh-lib-analyzer knowledge pages and absorption reports.
export function ingestDocDir(project: string, dir: string, maxFiles = 200): { added: number; skipped: number } {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return { added: 0, skipped: 0 };
  let added = 0, skipped = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 4 || added >= maxFiles) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name.startsWith('.')) continue;
      const full = path.join(d, f.name);
      if (f.isDirectory()) { walk(full, depth + 1); continue; }
      if (!f.name.endsWith('.md') && !f.name.endsWith('.mdx')) { skipped++; continue; }
      if (added >= maxFiles) return;
      try {
        const text = fs.readFileSync(full, 'utf8').slice(0, 20000);
        const rel = path.relative(root, full);
        addDoc(project, rel, text, 'ingest:' + path.basename(root));
        added++;
      } catch { skipped++; }
    }
  };
  walk(root, 0);
  return { added, skipped };
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
      const t = tokenize(h.title + ' ' + h.title + ' ' + h.body.slice(0, 2000));
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