// src/related.ts
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
var STOP = /* @__PURE__ */ new Set([
  // en
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "by",
  "at",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "we",
  "our",
  "you",
  "your",
  "they",
  "their",
  "he",
  "she",
  "him",
  "her",
  "i",
  "my",
  "me",
  "not",
  "no",
  "but",
  "if",
  "then",
  "than",
  "so",
  "such",
  "which",
  "who",
  "whom",
  "what",
  "when",
  "where",
  "why",
  "how",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "can",
  "could",
  "may",
  "might",
  "must",
  "shall",
  "should",
  "will",
  "would",
  "do",
  "does",
  "did",
  "has",
  "have",
  "had",
  "about",
  "into",
  "over",
  "under",
  "again",
  "further",
  "once",
  "only",
  "own",
  "same",
  "too",
  "very",
  "just",
  "also",
  "per",
  "via",
  // zh
  "\u7684",
  "\u4E86",
  "\u548C",
  "\u662F",
  "\u5728",
  "\u6709",
  "\u4E0E",
  "\u5C31",
  "\u90FD",
  "\u800C",
  "\u53CA",
  "\u6216",
  "\u4E00\u4E2A",
  "\u6211\u4EEC",
  "\u4F60\u4EEC",
  "\u4ED6\u4EEC",
  "\u8FD9\u4E2A",
  "\u90A3\u4E2A",
  "\u8FD9\u4E9B",
  "\u90A3\u4E9B",
  "\u4E0D",
  "\u6CA1\u6709",
  "\u53EF\u4EE5",
  "\u80FD\u591F",
  "\u5E94\u8BE5",
  "\u4F46\u662F",
  "\u56E0\u4E3A",
  "\u6240\u4EE5",
  "\u5982\u679C",
  "\u90A3\u4E48",
  "\u5982\u4F55",
  "\u4EC0\u4E48",
  "\u4E3A\u4EC0\u4E48",
  "\u600E\u4E48",
  "\u4E2D",
  "\u4E0A",
  "\u4E0B",
  "\u91CC",
  "\u5BF9",
  "\u4E3A",
  "\u4E8E",
  "\u4E4B",
  "\u5176",
  "\u88AB",
  "\u628A",
  "\u8BA9",
  "\u5411",
  "\u4ECE",
  "\u5230",
  "\u7B49",
  "\u7B49",
  "\u4EE5\u53CA",
  "\u5176\u4E2D",
  "\u4EE5\u53CA",
  "\u5206\u522B",
  "\u4E3B\u8981",
  "\u76F8\u5173",
  "\u57FA\u4E8E",
  "\u8FDB\u884C",
  "\u4F7F\u7528",
  "\u901A\u8FC7",
  "\u5BF9\u4E8E",
  "\u5173\u4E8E",
  "\u4E0D\u662F",
  "\u5C31\u662F",
  "\u8FD8\u662F",
  "\u4EE5\u53CA"
]);
function dbPath(project) {
  return path.join(project, ".rlab", "related.db");
}
function openDb(project) {
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
function tokenize(text) {
  const toks = [];
  const latin = text.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) || [];
  toks.push(...latin);
  const hanzi = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of hanzi) {
    const chars = [...run];
    for (let i = 0; i < chars.length - 1; i++) {
      const bigram = chars[i] + chars[i + 1];
      if (i + 2 < chars.length) {
        toks.push(chars[i] + chars[i + 1] + chars[i + 2]);
      }
      toks.push(bigram);
    }
  }
  return toks.filter((t) => !STOP.has(t) && t.length > 1);
}
function ftsText(text) {
  return tokenize(text).join(" ");
}
function mineKeywords(project, topN = 40) {
  const db = openDb(project);
  const n = db.prepare("SELECT COUNT(*) c FROM docs").get().c;
  if (!n) return [];
  const rows = db.prepare("SELECT id, title, body FROM docs").all();
  const df = /* @__PURE__ */ new Map();
  const tf = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const toks = [...new Set(tokenize(r.title + " " + r.body))];
    const seen = /* @__PURE__ */ new Set();
    const all = tokenize(r.title + " " + r.title + " " + r.body);
    for (const t of all) {
      if (!tf.has(t)) tf.set(t, /* @__PURE__ */ new Map());
      const m = tf.get(t);
      m.set(r.id, (m.get(r.id) || 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        df.set(t, (df.get(t) || 0) + 1);
      }
    }
  }
  const idf = (t) => Math.log(1 + n / (1 + (df.get(t) || 0)));
  const scored = [];
  for (const [t, perDoc] of tf) {
    let freq = 0;
    for (const f of perDoc.values()) freq += f;
    const score = freq / Math.max(1, perDoc.size) * idf(t);
    scored.push({ term: t, score, freq, docs: perDoc.size, last_seen: "" });
  }
  scored.sort((a, b) => b.score - a.score);
  const upsert = db.prepare(`INSERT INTO keywords(term, score, freq, docs) VALUES (?,?,?,?)
    ON CONFLICT(term) DO UPDATE SET score=excluded.score, freq=excluded.freq, docs=excluded.docs, last_seen=date('now')`);
  for (const k of scored.slice(0, topN * 3)) upsert.run(k.term, k.score, k.freq, k.docs);
  return scored.slice(0, topN);
}
function search(project, query, k = 10) {
  const db = openDb(project);
  const q = ftsText(query).split(" ").filter(Boolean).slice(0, 12).map((t) => '"' + t + '"').join(" OR ");
  if (!q) return [];
  const rows = db.prepare(`
    SELECT d.id, d.title, d.body, d.source, d.added, bm25(docs_fts) AS rank
    FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
    WHERE docs_fts MATCH ?
    ORDER BY rank LIMIT ?
  `).all(q, k);
  return rows;
}
function bm25Scores(query, docs, k1 = 1.5, b = 0.75) {
  const scores = /* @__PURE__ */ new Map();
  const qt = new Set(tokenize(query));
  if (!qt.size || !docs.length) return scores;
  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.text.length, 0) / N;
  const df = /* @__PURE__ */ new Map();
  const docToks = docs.map((d) => {
    const toks = tokenize(d.text);
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
    return toks;
  });
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    let s = 0;
    const tf = /* @__PURE__ */ new Map();
    for (const t of docToks[i]) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of qt) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      const denom = f + k1 * (1 - b + b * (d.text.length / avgdl));
      s += idf * (f * (k1 + 1) / denom);
    }
    if (s > 0) scores.set(d.id, s);
  }
  return scores;
}
function rrfFuse(lists, k = 60) {
  const fused = /* @__PURE__ */ new Map();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      fused.set(id, (fused.get(id) || 0) + 1 / (k + i + 1));
    }
  }
  return fused;
}
function hybridSearch(project, query, k = 10) {
  const db = openDb(project);
  const rows = db.prepare("SELECT id, title, body, source, added FROM docs").all();
  if (!rows.length) return [];
  const fts = search(project, query, k * 2).map((d) => d.id);
  const bm = bm25Scores(query, rows.map((d) => ({ id: d.id, text: d.title + " " + d.body })));
  const bmIds = [...bm.entries()].sort((a, b) => b[1] - a[1]).slice(0, k * 2).map(([id]) => id);
  const fused = rrfFuse([fts, bmIds], 60);
  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => Number(id));
  const byId = new Map(rows.map((d) => [d.id, d]));
  return ranked.map((id) => byId.get(id)).filter((d) => !!d);
}
function absorbLedger(project) {
  const db = openDb(project);
  const rows = db.prepare("SELECT path, key, doc_id, page FROM absorbed").all();
  return new Map(rows.map((r) => [r.path, r]));
}
function recordAbsorbed(project, row) {
  const db = openDb(project);
  db.prepare(`INSERT INTO absorbed(path, key, doc_id, page, ts) VALUES (?,?,?,?,date('now'))
    ON CONFLICT(path) DO UPDATE SET key=excluded.key, doc_id=excluded.doc_id, page=excluded.page, ts=excluded.ts`).run(row.path, row.key, row.docId ?? null, row.page ?? null);
}
function updateDoc(project, id, title, body, source, opts = {}) {
  const db = openDb(project);
  const safeTitle = typeof title === "string" && title.trim().length > 0 ? title : "(untitled)";
  const before = db.prepare("SELECT title, body FROM docs WHERE id=?").get(id);
  if (before === void 0) return false;
  db.prepare("INSERT INTO docs_fts(docs_fts, rowid, title, body) VALUES('delete', ?, ?, ?)").run(id, before.title, before.body);
  db.prepare("UPDATE docs SET title=?, body=?, source=?, added=date('now') WHERE id=?").run(safeTitle, ftsText(safeTitle + " " + (typeof body === "string" ? body : "")), source, id);
  db.prepare("INSERT INTO docs_fts(rowid, title, body) VALUES (?,?,?)").run(id, safeTitle, ftsText(safeTitle + " " + (typeof body === "string" ? body : "")));
  if (opts.refreshLexicon !== false) mineKeywords(project, 40);
  return true;
}
function addDoc(project, title, body, source, opts = {}) {
  const db = openDb(project);
  const safeTitle = typeof title === "string" && title.trim().length > 0 ? title : "(untitled)";
  const safeBody = typeof body === "string" ? body : "";
  const safeSource = typeof source === "string" ? source : "";
  const r = db.prepare("INSERT INTO docs(title, body, source) VALUES (?,?,?)").run(safeTitle, ftsText(safeTitle + " " + safeBody), safeSource);
  if (opts.refreshLexicon !== false) mineKeywords(project, 40);
  return Number(r.lastInsertRowid);
}
function ingestDocDir(project, dir, opts = {}) {
  const o = typeof opts === "number" ? { max: opts } : opts ?? {};
  const max = Math.max(1, Number(o.max) || 200);
  const budgetMs = Math.max(50, Number(o.budgetMs) || 4e3);
  const prefix = o.ledgerPrefix ?? "ingest:";
  const empty = { found: 0, added: 0, updated: 0, skipped: 0, unchanged: 0, remaining: 0 };
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return empty;
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(root).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) return empty;
  const files = [];
  const walk = (d, depth) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const f of entries) {
      if (f.name.startsWith(".")) continue;
      const full = path.join(d, f.name);
      if (f.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!f.name.endsWith(".md") && !f.name.endsWith(".mdx")) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      files.push({ full, rel: path.relative(root, full), key: st.size + ":" + Math.round(st.mtimeMs), mtimeMs: st.mtimeMs });
    }
  };
  walk(root, 0);
  const ledger = absorbLedger(project);
  const pending = files.filter((f) => ledger.get(prefix + f.rel)?.key !== f.key).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const started = Date.now();
  let added = 0, updated = 0, skipped = 0;
  for (const f of pending) {
    if (added + updated >= max) break;
    if (Date.now() - started > budgetMs) break;
    try {
      const text = fs.readFileSync(f.full, "utf8").slice(0, 2e4).toWellFormed();
      const before = ledger.get(prefix + f.rel);
      let docId = null;
      if (before?.doc_id != null && updateDoc(project, before.doc_id, f.rel, text, "ingest:" + path.basename(root), { refreshLexicon: false })) {
        docId = before.doc_id;
        updated++;
      } else {
        docId = addDoc(project, f.rel, text, "ingest:" + path.basename(root), { refreshLexicon: false });
        added++;
      }
      recordAbsorbed(project, { path: prefix + f.rel, key: f.key, docId, page: null });
    } catch {
      skipped++;
    }
  }
  if (added + updated > 0) mineKeywords(project, 40);
  return {
    found: files.length,
    added,
    updated,
    skipped,
    unchanged: files.length - pending.length,
    remaining: Math.max(0, pending.length - added - updated - skipped)
  };
}
function topKeywords(project, topN = 30) {
  const db = openDb(project);
  return db.prepare("SELECT term, score, freq, docs FROM keywords ORDER BY score DESC LIMIT ?").all(topN);
}
function expandSearch(project, seed, rounds = 2, k = 8) {
  const db = openDb(project);
  let query = seed;
  const seenTerms = new Set(tokenize(seed));
  const report = [];
  let final = [];
  for (let r = 1; r <= rounds; r++) {
    const hits = hybridSearch(project, query, k);
    final = hits;
    const toks = /* @__PURE__ */ new Map();
    for (const h of hits) {
      const t = tokenize(h.title + " " + h.title + " " + h.body.slice(0, 2e3).toWellFormed());
      for (const x of t) toks.set(x, (toks.get(x) || 0) + 1);
    }
    const newTerms = [...toks.entries()].filter(([t]) => !seenTerms.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
    report.push({ round: r, newTerms, hits });
    if (!newTerms.length) break;
    for (const t of newTerms) seenTerms.add(t);
    query = [query, ...newTerms].join(" OR ");
  }
  return { rounds: report, final, lexicon: topKeywords(project, 30) };
}

// src/rewrite.ts
var RULES = [
  {
    name: "filler-in-order-to",
    pattern: /\bin order to\b/gi,
    replace: () => "to",
    reason: 'filler "in order to" \u2192 "to"'
  },
  {
    name: "filler-due-to-the-fact",
    pattern: /\bdue to the fact that\b/gi,
    replace: () => "because",
    reason: 'filler "due to the fact that" \u2192 "because"'
  },
  {
    name: "filler-it-should-be-noted",
    pattern: /\bit (?:should be|is) (?:also )?noted that\b/gi,
    replace: () => "",
    reason: 'filler "it should be noted that" \u2192 delete'
  },
  {
    name: "weak-get",
    pattern: /\bget(s|ting|t)?\b/gi,
    replace: (m) => m[1] ? "obtain" : "obtain",
    reason: "weak verb get \u2192 obtain"
  },
  {
    name: "weak-make",
    pattern: /\bmake(s|ing)?\b/gi,
    replace: (m) => m[1] ? "produce" : "produce",
    reason: "weak verb make \u2192 produce"
  },
  {
    name: "weak-use",
    pattern: /\buse(s|d|ing)?\b/gi,
    replace: () => "employ",
    reason: "weak verb use \u2192 employ (academic register)"
  },
  {
    name: "passive-by",
    pattern: /\b([A-Z][\w\s-]{0,20}?)\s+(was|were) (\w+ed) by ([A-Z][\w\s]+?)(?=[\.\,]|$)/gi,
    replace: (m) => {
      const s = m[4].trim();
      return s.charAt(0).toUpperCase() + s.slice(1) + " " + m[3];
    },
    reason: 'passive "was X-ed by Y" \u2192 active "Y X-ed"'
  },
  {
    name: "nominalization",
    pattern: /\b(performed|carried out|conducted) an? (experiment|study|analysis)\b/gi,
    replace: (m) => m[2] + " (as verb: " + (m[1].startsWith("perf") ? "experimented" : "studied") + ")",
    reason: "nominalization \u2192 verb form"
  },
  {
    name: "hedge-very",
    pattern: /\bvery (important|significant|large|small|good)\b/gi,
    replace: () => "markedly",
    reason: 'vague "very X" \u2192 precise "markedly"'
  },
  {
    name: "quantifier-many",
    pattern: /\ba (large )?number of\b/gi,
    replace: () => "many",
    reason: 'wordy "a (large) number of" \u2192 "many"'
  }
];
function rewriteText(text) {
  let cur = text;
  const applied = [];
  for (const rule of RULES) {
    const before = cur;
    cur = cur.replace(rule.pattern, (...args) => {
      const m = args;
      return rule.replace(m);
    });
    const count = (before.match(new RegExp(rule.pattern.source, rule.pattern.flags)) || []).length;
    if (count > 0) applied.push({ name: rule.name, reason: rule.reason, count });
  }
  cur = cur.replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
  return { before: text, after: cur, applied };
}
function rewriteReport(text) {
  const r = rewriteText(text);
  const lines = ["# Rewrite report", "", "## Applied rules (" + r.applied.length + ")"];
  for (const a2 of r.applied) lines.push("- " + a2.name + " \xD7" + a2.count + " \u2014 " + a2.reason);
  if (!r.applied.length) lines.push("- (none \u2014 text is clean)");
  lines.push("", "## After", "", r.after, "", "## Diff (before \u2192 after)");
  const b = r.before.split("\n");
  const a = r.after.split("\n");
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    if (b[i] !== a[i]) lines.push("- " + (b[i] ?? "").trim() + "  \u2192  " + (a[i] ?? "").trim());
  }
  return lines.join("\n");
}

// src/extract.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
function betaConfidence(prior, cited, weight = 100) {
  return (prior * weight + cited) / (weight + cited);
}
var TEMPLATES = [
  {
    type: "contribution",
    re: /we (propose|present|introduce|design|develop) ([A-Z][\w\s-]{3,60}?)(?:,| for| to| which| that| \.)/gi,
    pick: (m) => ({ subject: m[2].trim() })
  },
  {
    type: "contribution",
    re: /本(文|工作)(提出|设计|介绍|开发)(了)?([\u4e00-\u9fff\w\s-]{3,60}?)(?:[,。]|用于|用以|使用|使|针对|$)/gi,
    pick: (m) => ({ subject: (m[4] || "").trim() })
  },
  {
    type: "result",
    re: /(achieves|reaches|attains|obtains) ([\d.]+[%x]?) (?:on|in) ([\w\s-]{2,40}?)(?:[,.]| and | while |$)/gi,
    pick: (m) => ({ subject: "result", value: m[2].trim(), task: m[3].trim() })
  },
  {
    type: "result",
    re: /(?:达到|获得|取得)(了)?([\d.]+[%x]?)(?:的)?(?:成绩|结果|分数|效果)?(?:在|于)?([\u4e00-\u9fff\w\s-]{2,40}?)(?:[,。]|$)/gi,
    pick: (m) => ({ subject: "result", value: m[2].trim(), task: m[3].trim() })
  },
  {
    type: "comparison",
    re: /outperforms? ([\w\s-]{2,40}?) by ([\d.]+[%x]?)/gi,
    pick: (m) => ({ subject: m[1].trim(), value: m[2].trim() })
  },
  {
    type: "comparison",
    re: /优于([\u4e00-\u9fff\w\s-]{2,40}?)(?:约|大约)?([\d.]+[%x]?)/gi,
    pick: (m) => ({ subject: m[1].trim(), value: m[2].trim() })
  }
];
function extractClaims(text) {
  const claims = [];
  for (const t of TEMPLATES) {
    const re = new RegExp(t.re.source, t.re.flags.includes("g") ? t.re.flags : t.re.flags + "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const p = t.pick(m);
        claims.push({ type: t.type, ...p, context: text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\s+/g, " ").trim() });
      } catch {
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return claims;
}
var claimsFile = (project) => path2.join(project, ".rlab", "claims.jsonl");
function loadClaims(project) {
  try {
    const lines = fs2.readFileSync(claimsFile(project), "utf8").split("\n").filter(Boolean);
    return lines.map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
function addClaims(project, docId, text) {
  const existing = loadClaims(project);
  let nextId = existing.length ? Math.max(...existing.map((c) => c.id)) + 1 : 1;
  const fresh = extractClaims(text);
  const prior = 0.5;
  const added = [];
  fs2.mkdirSync(path2.dirname(claimsFile(project)), { recursive: true });
  for (const c of fresh) {
    const claim = { id: nextId++, docId, ...c, cited: 0, confidence: betaConfidence(prior, 0), date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) };
    fs2.appendFileSync(claimsFile(project), JSON.stringify(claim) + "\n", "utf8");
    added.push(claim);
  }
  return added;
}
function citeClaim(project, claimId, weight = 100) {
  const claims = loadClaims(project);
  const c = claims.find((x) => x.id === claimId);
  if (!c) return null;
  c.cited += 1;
  c.confidence = betaConfidence(0.5, c.cited, weight);
  fs2.writeFileSync(claimsFile(project), claims.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
  return c;
}
function claimsReport(project, type) {
  const claims = loadClaims(project);
  if (!claims.length) return "No claims recorded yet. Use rlab_claim action=extract.";
  const rows = type ? claims.filter((c) => c.type === type) : claims;
  const lines = ["# Claim ledger \u2014 " + project + " (" + rows.length + " claims)", ""];
  for (const c of rows) {
    lines.push("[" + c.id + "] " + c.type.toUpperCase() + "  conf=" + c.confidence.toFixed(3) + " cited=" + c.cited);
    if (c.subject) lines.push("  subject: " + c.subject);
    if (c.value) lines.push("  value: " + c.value + (c.task ? "  on: " + c.task : ""));
    lines.push('  ctx: "' + c.context.slice(0, 140) + '"');
    lines.push("");
  }
  return lines.join("\n");
}

// src/suggest.ts
async function suggestExternal(query, max = 5) {
  const out = [];
  try {
    const url = "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=" + max + "&search=" + encodeURIComponent(query);
    const res = await fetch(url, { headers: { "User-Agent": "dsh-research-lab/0.1" }, signal: AbortSignal.timeout(8e3) });
    if (!res.ok) return out;
    const data = await res.json();
    const terms = data[1] || [];
    for (const t of terms) out.push({ term: t, source: "wikipedia" });
  } catch {
  }
  return out;
}
async function suggestZh(query, max = 5) {
  const out = [];
  try {
    const url = "https://zh.wikipedia.org/w/api.php?action=opensearch&format=json&limit=" + max + "&search=" + encodeURIComponent(query);
    const res = await fetch(url, { headers: { "User-Agent": "dsh-research-lab/0.1" }, signal: AbortSignal.timeout(8e3) });
    if (!res.ok) return out;
    const data = await res.json();
    const terms = data[1] || [];
    for (const t of terms) out.push({ term: t, source: "wikipedia-zh" });
  } catch {
  }
  return out;
}

// src/arxiv.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname3, join as join3 } from "node:path";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var THROTTLE_FILE = join3(process.env.DSH_HOME ?? join3(homedir(), ".dsh"), ".arxiv-throttle");
var MIN_GAP_MS = 3100;
async function gate() {
  for (; ; ) {
    let last = 0;
    try {
      last = Number(readFileSync3(THROTTLE_FILE, "utf8")) || 0;
    } catch {
      last = 0;
    }
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  try {
    mkdirSync3(dirname3(THROTTLE_FILE), { recursive: true });
    writeFileSync2(THROTTLE_FILE, String(Date.now()));
  } catch {
  }
}
function retryAfterMs(header) {
  const n = Number(String(header ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.min(n * 1e3, 6e4) : 0;
}
async function arxivQuery(params) {
  const qs = new URLSearchParams(params).toString();
  const url = "https://export.arxiv.org/api/query?" + qs;
  const fetchOne = () => {
    const headers = { "User-Agent": "dsh-research-lab/0.2 (local research agent; arxiv api client; +https://info.arxiv.org/help/api/)" };
    return fetch(url, { headers, signal: AbortSignal.timeout(15e3) });
  };
  const delays = [0, 4e3, 12e3];
  let res = null;
  let asked = 0;
  let last = "";
  for (let i = 0; i < delays.length; i++) {
    const wait = Math.max(delays[i], i > 0 ? asked : 0);
    if (wait > 0) await sleep(wait);
    asked = 0;
    try {
      await gate();
      res = await fetchOne();
    } catch (err) {
      last = String(err.message ?? err).slice(0, 120);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      asked = retryAfterMs(res.headers.get("retry-after"));
      last = "HTTP " + res.status + " (arXiv rate limit: ~1 request per 3s; a burst gets the IP temporarily blocked)" + (asked ? "; server asked to wait " + Math.round(asked / 1e3) + "s" : "");
      continue;
    }
    if (!res.ok) throw new Error("arXiv HTTP " + res.status);
    break;
  }
  if (res == null || !res.ok) throw new Error("arXiv: " + (last || "unreachable after 3 attempts"));
  const xml = await res.text();
  const papers = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const grab = (tag) => {
      const t = e.match(new RegExp("<" + tag + ">([\\s\\S]*?)<\\/" + tag + ">"));
      return t ? t[1].trim() : "";
    };
    const idRaw = grab("id");
    const id = (idRaw.match(/\/abs\/([^\/]+)/) || [])[1] || idRaw;
    const title = grab("title").replace(/\s+/g, " ").trim();
    const summary = grab("summary").replace(/\s+/g, " ").trim();
    const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((x) => x[1].trim());
    const categories = [...e.matchAll(/<category term="([^"]+)"/g)].map((x) => x[1]);
    papers.push({
      id,
      title,
      authors,
      published: grab("published"),
      updated: grab("updated"),
      summary,
      categories,
      absUrl: "https://arxiv.org/abs/" + id,
      pdfUrl: "https://arxiv.org/pdf/" + id,
      comment: grab("arxiv:comment")
    });
  }
  return papers;
}
async function arxivByIds(ids) {
  if (!ids.length) return [];
  return arxivQuery({ id_list: ids.join(","), max_results: String(ids.length) });
}
async function arxivSearch(term, maxResults = 20, sortBy = "submittedDate") {
  return arxivQuery({ search_query: "all:" + esc(term), start: "0", max_results: String(maxResults), sortBy, sortOrder: "descending" });
}
function formatPapers(papers, withSummary = false) {
  const lines = [];
  for (const p of papers) {
    lines.push("[" + p.id + "] " + p.title);
    lines.push("  " + p.absUrl);
    lines.push("  " + (p.authors.slice(0, 6).join(", ") + (p.authors.length > 6 ? " et al." : "")));
    lines.push("  published " + p.published.slice(0, 10) + " | " + p.categories.slice(0, 4).join(", "));
    if (withSummary) lines.push("  " + p.summary.slice(0, 500));
    lines.push("");
  }
  return lines.join("\n").trim();
}

// src/store.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";
var RLAB_DIR = ".rlab";
function rlabDir(project) {
  const abs = path3.resolve(project);
  return path3.join(abs, RLAB_DIR);
}
function ensureDir(p) {
  fs3.mkdirSync(p, { recursive: true });
}
var WIKI_DIR = "wiki";
function parseFrontmatter(text) {
  const out = {};
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!mm) continue;
    const key = mm[1];
    const val = mm[2].trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      out[key] = val.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      out[key] = val;
    }
  }
  return out;
}
function wikiPath(project, kind, id) {
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, "_");
  return path3.join(rlabDir(project), WIKI_DIR, kind, safe + ".md");
}
function writeWikiPage(project, page) {
  const p = wikiPath(project, page.kind, page.id);
  const fm = [
    "---",
    "id: " + page.id,
    "kind: " + page.kind,
    "title: " + page.title.replace(/\n/g, " "),
    "updated: " + page.updated,
    page.tags?.length ? "tags: [" + page.tags.join(", ") + "]" : "tags: []",
    "---",
    ""
  ].join("\n");
  const body = [
    fm,
    "# " + page.title,
    "",
    page.content.trim(),
    ""
  ].join("\n");
  ensureDir(path3.dirname(p));
  fs3.writeFileSync(p, body, "utf8");
  const log = path3.join(rlabDir(project), "wiki", "log.md");
  const stamp = (/* @__PURE__ */ new Date()).toISOString();
  fs3.appendFileSync(log, "- " + stamp + "  " + page.kind + ":" + page.id + "  " + page.title.replace(/[\r\n]+/g, " ") + "\n", "utf8");
  return p;
}
function listWiki(project) {
  const root = path3.join(rlabDir(project), WIKI_DIR);
  const pages = [];
  const kinds = ["experiment", "literature", "decision", "todo"];
  for (const kind of kinds) {
    const dir = path3.join(root, kind);
    if (!fs3.existsSync(dir)) continue;
    for (const f of fs3.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const full = path3.join(dir, f);
      const text = fs3.readFileSync(full, "utf8");
      const fm = parseFrontmatter(text);
      const title = String(fm.title || (text.match(/^# (.+)$/m) || [])[1] || f.replace(/\.md$/, ""));
      const updated = String(fm.updated || "");
      const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [String(fm.tags)] : [];
      pages.push({ kind, id: f.replace(/\.md$/, ""), title, updated, tags, content: "" });
    }
  }
  return pages.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
function rebuildWikiIndex(project) {
  const pages = listWiki(project);
  const lines = ["# Research Wiki Index", "", "Auto-generated by dsh-research-lab. Do not edit by hand.", ""];
  const kinds = [
    { k: "experiment", label: "## Experiments" },
    { k: "literature", label: "## Literature" },
    { k: "decision", label: "## Decisions" },
    { k: "todo", label: "## TODO" }
  ];
  for (const { k, label } of kinds) {
    const sub = pages.filter((p) => p.kind === k);
    if (!sub.length) continue;
    lines.push(label);
    for (const p of sub) {
      lines.push("- [" + p.title + "](wiki/" + k + "/" + p.id + ".md)" + (p.updated ? "  _" + p.updated + "_" : ""));
    }
    lines.push("");
  }
  const idx = path3.join(rlabDir(project), WIKI_DIR, "index.md");
  ensureDir(path3.dirname(idx));
  fs3.writeFileSync(idx, lines.join("\n") + "\n", "utf8");
  return idx;
}
function benchFile(project) {
  return path3.join(rlabDir(project), "bench.jsonl");
}
function appendBench(project, row) {
  const file = benchFile(project);
  ensureDir(path3.dirname(file));
  fs3.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
  return readBench(project);
}
function readBench(project) {
  const file = benchFile(project);
  if (!fs3.existsSync(file)) return [];
  const rows = [];
  for (const line of fs3.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
    }
  }
  return rows;
}
function benchReport(project, model, task) {
  let rows = readBench(project);
  if (!rows.length) return "No benchmark rows yet for " + project + ". Add one with rlab_bench.";
  if (model) rows = rows.filter((r) => r.model.toLowerCase().includes(model.toLowerCase()));
  if (task) rows = rows.filter((r) => r.task.toLowerCase().includes(task.toLowerCase()));
  if (!rows.length) return "No rows match the filter.";
  const lines = ["# Bench ledger \u2014 " + project, ""];
  const byTask = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const arr = byTask.get(r.task) || [];
    arr.push(r);
    byTask.set(r.task, arr);
  }
  for (const [t, rs] of [...byTask.entries()].sort()) {
    lines.push("## " + t + "  (" + rs.length + " runs)");
    const byModel = /* @__PURE__ */ new Map();
    for (const r of rs) {
      const arr = byModel.get(r.model) || [];
      arr.push(r);
      byModel.set(r.model, arr);
    }
    for (const [m, mr] of [...byModel.entries()].sort()) {
      const latest = mr[mr.length - 1];
      const all = mr.map((r) => r.score.toFixed(4)).join(" \u2192 ");
      lines.push("- **" + m + "**  latest=" + latest.score.toFixed(4) + " (" + latest.metric + ")  history=[" + all + "]");
      if (latest.split) lines.push("  - split=" + latest.split + (latest.hf_subset ? " subset=" + latest.hf_subset : "") + "  " + latest.date + (latest.note ? "  \u2014 " + latest.note : ""));
    }
    const splits = new Set(rs.map((r) => r.split || "?"));
    if (splits.size > 1) {
      lines.push("  \u26A0\uFE0F **\u53E3\u5F84\u4E0D\u4E00\u81F4**: runs use different splits (" + [...splits].join(", ") + ") \u2014 do NOT compare across splits.");
    }
    lines.push("");
  }
  lines.push("_Ledger: " + benchFile(project) + "_");
  return lines.join("\n");
}

// src/ref.ts
import { execSync } from "node:child_process";
import * as fs4 from "node:fs";
import * as path4 from "node:path";
function cloneAndStudy(url, outDir, maxTree = 30) {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/\s]+?)(?:\.git)?(?:\/|$)/);
  if (!m) throw new Error("not a github.com URL: " + url);
  const repo = m[1] + "/" + m[2].replace(/\.git$/, "");
  fs4.mkdirSync(outDir, { recursive: true });
  const dir = path4.join(outDir, m[2].replace(/\.git$/, ""));
  execSync("git clone --depth 1 https://github.com/" + repo + '.git "' + dir + '"', { stdio: "pipe", timeout: 12e4 });
  const head = (name, n = 40) => {
    const f = path4.join(dir, name);
    try {
      return fs4.readFileSync(f, "utf8").slice(0, 1800);
    } catch {
      return "";
    }
  };
  const readme = head("README.md") || head("README_EN.md") || head("README.adoc");
  const claudeMd = head("CLAUDE.md") || head("AGENTS.md");
  const tree = [];
  const walk = (d, depth) => {
    if (depth > 2 || tree.length >= maxTree) return;
    for (const f of fs4.readdirSync(d, { withFileTypes: true })) {
      if (f.name.startsWith(".") || f.name === "node_modules") continue;
      const rel = path4.relative(dir, path4.join(d, f.name));
      tree.push((depth ? "  ".repeat(depth) : "") + rel + (f.isDirectory() ? "/" : ""));
      if (f.isDirectory()) walk(path4.join(d, f.name), depth + 1);
    }
  };
  walk(dir, 0);
  let files = 0;
  const count = (d) => {
    for (const f of fs4.readdirSync(d, { withFileTypes: true })) {
      if (f.name.startsWith(".")) continue;
      if (f.isDirectory()) count(path4.join(d, f.name));
      else files++;
    }
  };
  count(dir);
  const note = [
    "# Ref study: " + repo,
    "",
    "source: https://github.com/" + repo + "  |  cloned: " + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    "files: " + files,
    "",
    "## README (excerpt)",
    "",
    readme,
    "",
    claudeMd ? "## CLAUDE.md / AGENTS.md (excerpt - often reveals the real contract)" : "",
    "",
    claudeMd,
    "",
    "## Structure (top 2 levels)",
    "",
    "```",
    ...tree,
    "```",
    "",
    "## Absorption notes (fill in)",
    "",
    "| aspect | verdict |",
    "|---|---|",
    "| what it is |  |",
    "| absorb-worthy mechanisms |  |",
    "| code to port |  |",
    "| conflicts with our design |  |",
    "| license |  |",
    ""
  ];
  const noteFile = path4.join(dir, "REF.md");
  fs4.writeFileSync(noteFile, note.join("\n"), "utf8");
  return { repo, dir, readme, claudeMd, tree, files, noteFile };
}

// src/scoop.ts
var AXES = [
  ["problem", "Problem framing \u2014 \u63D0\u51FA\u7684\u95EE\u9898\u662F\u4EC0\u4E48"],
  ["mechanism", "Core mechanism \u2014 \u771F\u6B63\u505A\u529F\u7684\u6280\u672F\u52A8\u4F5C"],
  ["insight", "Key insight \u2014 \u4E3A\u4EC0\u4E48\u5B83\u5E94\u8BE5\u6210\u7ACB"],
  ["domain", "Application domain \u2014 \u7528\u5728\u54EA\u91CC"]
];
var FAMILIES = [
  ["original-problem", "Original-Problem \u2014 \u590D\u8FF0\u539F\u59CB\u7814\u7A76\u95EE\u9898"],
  ["broad-domain", "Broad-Domain \u2014 \u9AD8\u5C42\u9886\u57DF\uFF083-5 \u8BCD\uFF09"],
  ["method-signature", "Method-Signature \u2014 \u5177\u4F53\u6280\u672F\u52A8\u4F5C\uFF085-8 \u8BCD\uFF09"]
];
var DASH = "\u2014\uFF08\u672A\u586B\uFF09";
var NOT_DONE = "\u672A\u505A";
function scoopSlug(claim) {
  const ascii = String(claim ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (ascii.length >= 8) return ascii;
  let h = 5381;
  for (const ch of String(claim ?? "")) {
    h = h * 33 ^ (ch.codePointAt(0) ?? 0);
    h = h >>> 0;
  }
  return "scoop-" + h.toString(16).slice(0, 8);
}
function renderScoop(a) {
  const axes = a.axes ?? {};
  const filled = AXES.filter(([k]) => String(axes[k] ?? "").trim() !== "");
  const queries = Array.isArray(a.queries) ? a.queries : [];
  const doneFamilies = FAMILIES.filter(([f]) => queries.some((q) => q != null && q.family === f));
  const candidates = Array.isArray(a.candidates) ? a.candidates : [];
  const deep = candidates.filter((c) => c != null && typeof c.overlap === "number" && c.overlap >= 3);
  const L = [];
  const push = (...xs) => {
    for (const x of xs) L.push(x);
  };
  push("## 0. \u5224\u5B9A\u6458\u8981", "");
  push("- **\u4E3B\u5F20**\uFF1A" + (a.claim || DASH));
  push("- **\u5224\u5B9A**\uFF1A" + (a.verdict ?? "\u672A\u5224\u5B9A"));
  push("- **delta**\uFF1A" + (String(a.delta ?? "").trim() || DASH));
  push("- **\u8BC1\u636E\u5B8C\u5907\u5EA6**\uFF1A\u56DB\u8F74 " + filled.length + "/4 \xB7 \u67E5\u8BE2\u65CF " + doneFamilies.length + "/3 \xB7 \u5019\u9009 " + candidates.length + " \u7BC7 \xB7 \u673A\u5236\u91CD\u53E0\u22653 \u7684 " + deep.length + " \u7BC7");
  if (filled.length < 4 || doneFamilies.length < 3 || candidates.length === 0) {
    push("- **\u7F3A\u53E3**\uFF1A\u8FD9\u4EFD\u5BA1\u8BA1\u5E76\u4E0D\u5B8C\u6574 \u2014\u2014 \u4E0B\u9762\u6807 " + NOT_DONE + " \u7684\u6B65\u9AA4\u4E0D\u80FD\u8BFB\u6210\u201C\u67E5\u8FC7\u4E86\u3001\u6CA1\u6709\u201D\u3002");
  }
  push("");
  push("## 1. \u4E3B\u5F20\uFF08\u8981\u68C0\u9A8C\u7684\u65B0\u9896\u6027\uFF09", "", a.claim || DASH, "");
  push("## 2. Step 1 \u2014 \u56DB\u8F74\u5206\u89E3", "");
  push("| \u8F74 | \u5185\u5BB9 |", "| :--- | :--- |");
  for (const [k, label] of AXES) {
    const v = String(axes[k] ?? "").trim();
    push("| " + label + " | " + (v || DASH) + " |");
  }
  push("", filled.length === 4 ? "\u56DB\u8F74\u9F50\u5907\u3002" : "\u56DB\u8F74\u53EA\u586B\u4E86 " + filled.length + "/4 \u2014\u2014 \u7A7A\u8F74\u4F1A\u8BA9\u91CD\u53E0\u8BC4\u5206\u5931\u53BB\u610F\u4E49\u3002", "");
  push("## 3. Step 2 \u2014 \u4E09\u4E2A\u4E92\u8865\u67E5\u8BE2\u4E0E\u8BC1\u636E", "");
  for (const [f, label] of FAMILIES) {
    const qs = queries.filter((q) => q != null && q.family === f);
    push("### " + label, "");
    if (qs.length === 0) {
      push(NOT_DONE + "\uFF08\u8FD9\u4E00\u65CF\u6CA1\u6709\u67E5\u8BE2\u8BB0\u5F55\uFF09", "");
      continue;
    }
    for (const q of qs) {
      push("- \u67E5\u8BE2\uFF1A`" + String(q?.query ?? "") + "`");
      const hits = Array.isArray(q?.hits) ? q.hits : [];
      if (hits.length === 0) {
        push("  - \u65E0\u547D\u4E2D");
        continue;
      }
      for (const h of hits.slice(0, 12)) {
        push("  - " + (h?.title ?? "") + (h?.url ? " \u2014 " + h.url : "") + (h?.detail ? "  _" + h.detail + "_" : ""));
      }
    }
    push("");
  }
  push("## 4. Step 3-4 \u2014 \u5019\u9009\u4E0E\u91CD\u53E0\u8BC4\u5206\uFF080-4 = \u547D\u4E2D\u51E0\u8F74\uFF09", "");
  if (candidates.length === 0) {
    push(NOT_DONE + "\uFF08\u6CA1\u6709\u5019\u9009\u8BB0\u5F55\uFF09", "");
  } else {
    push("| \u5019\u9009 | \u91CD\u53E0 | \u5907\u6CE8 |", "| :--- | ---: | :--- |");
    for (const c of candidates) {
      const o = c != null && typeof c.overlap === "number" ? String(c.overlap) : "?";
      push("| " + (c?.title ?? "") + " | " + o + " | " + (c?.notes ?? "") + " |");
    }
    push("", "\u91CD\u53E0\u22653\uFF08\u673A\u5236\u5C42\u9762\u50CF\u7684\uFF09\u5E94\u8FDB\u5165\u5168\u6587\u6DF1\u8BFB\uFF1A" + (deep.length ? deep.map((c) => c.title).join("\u3001") : "\u65E0"), "");
  }
  push("## 5. Step 5-7 \u2014 \u6DF1\u8BFB\u3001\u6BD4\u8F83\u3001delta", "");
  const deepNotes = candidates.some((c) => String(c?.notes ?? "").trim() !== "");
  push("- Step 5 \u5168\u6587\u6DF1\u8BFB\uFF1A" + (deepNotes ? "\u6709\u8BB0\u5F55\uFF08\u89C1\u8868\u5185\u5907\u6CE8\uFF09" : NOT_DONE));
  push("- Step 6 \u4E0E\u4E3B\u5F20\u6BD4\u8F83\uFF1A" + (a.verdict ? "\u505A\u4E86\uFF0C\u5224\u5B9A " + a.verdict : NOT_DONE));
  push("- Step 7 delta \u9648\u8FF0\uFF1A" + (String(a.delta ?? "").trim() ? "\u89C1 \xA70" : NOT_DONE));
  if (String(a.notes ?? "").trim()) push("", "\u8865\u5145\uFF1A" + String(a.notes));
  push("");
  push("## 6. \u65B9\u6CD5\u51FA\u5904", "");
  push("\u4E03\u6B65\u6D41\u7A0B / \u56DB\u8F74 / \u4E09\u67E5\u8BE2 / 0-4 \u91CD\u53E0\u8BC4\u5206 \u53D6\u81EA microsoft/ResearchStudio-Idea \u7684 `scoop_check` skill");
  push("\uFF08[arXiv 2607.04439](https://arxiv.org/abs/2607.04439)\uFF0CMIT\uFF09\u3002\u672C\u9875\u7531 `rlab_scoop` \u751F\u6210\uFF1A\u5B83\u53EA\u8D1F\u8D23");
  push("**\u7ED3\u6784\u4E0E\u8BC1\u636E\u7559\u75D5**\uFF1B\u68C0\u7D22\u7531 dsh-search \u7684 `search_open` / `search_arxiv` \u5B8C\u6210\uFF08\u5404\u53F8\u5176\u804C\uFF09\u3002");
  return L.join("\n").replace(/\n{3,}/g, "\n\n");
}
export {
  absorbLedger,
  addClaims,
  addDoc,
  appendBench,
  arxivByIds,
  arxivQuery,
  arxivSearch,
  benchFile,
  benchReport,
  betaConfidence,
  citeClaim,
  claimsReport,
  cloneAndStudy,
  expandSearch,
  extractClaims,
  formatPapers,
  ftsText,
  hybridSearch,
  ingestDocDir,
  listWiki,
  loadClaims,
  mineKeywords,
  openDb,
  parseFrontmatter,
  readBench,
  rebuildWikiIndex,
  recordAbsorbed,
  renderScoop,
  rewriteReport,
  rewriteText,
  rlabDir,
  scoopSlug,
  search,
  suggestExternal,
  suggestZh,
  tokenize,
  topKeywords,
  updateDoc,
  wikiPath,
  writeWikiPage
};
