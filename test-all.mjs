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
function addDoc(project, title, body, source) {
  const db = openDb(project);
  const r = db.prepare("INSERT INTO docs(title, body, source) VALUES (?,?,?)").run(title, ftsText(title + " " + body), source);
  mineKeywords(project, 40);
  return Number(r.lastInsertRowid);
}
function ingestDocDir(project, dir, maxFiles = 200) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return { added: 0, skipped: 0 };
  let added = 0, skipped = 0;
  const walk = (d, depth) => {
    if (depth > 4 || added >= maxFiles) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name.startsWith(".")) continue;
      const full = path.join(d, f.name);
      if (f.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!f.name.endsWith(".md") && !f.name.endsWith(".mdx")) {
        skipped++;
        continue;
      }
      if (added >= maxFiles) return;
      try {
        const text = fs.readFileSync(full, "utf8").slice(0, 2e4);
        const rel = path.relative(root, full);
        addDoc(project, rel, text, "ingest:" + path.basename(root));
        added++;
      } catch {
        skipped++;
      }
    }
  };
  walk(root, 0);
  return { added, skipped };
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
      const t = tokenize(h.title + " " + h.title + " " + h.body.slice(0, 2e3));
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
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
async function arxivQuery(params) {
  const qs = new URLSearchParams(params).toString();
  const url = "https://export.arxiv.org/api/query?" + qs;
  const fetchOne = () => fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (dsh-research-lab/0.1)" }, signal: AbortSignal.timeout(3e4) });
  let res = await fetchOne();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await fetchOne();
  }
  if (!res.ok) throw new Error("arXiv HTTP " + res.status);
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
function wikiPath(project, kind, id) {
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, "_");
  return path3.join(rlabDir(project), WIKI_DIR, kind, safe + ".md");
}
function writeWikiPage(project, page) {
  const p = wikiPath(project, page.kind, page.id);
  const body = [
    "# " + page.title,
    "",
    "kind: " + page.kind + "  |  id: " + page.id + "  |  updated: " + page.updated + (page.tags?.length ? "  |  tags: " + page.tags.join(", ") : ""),
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
      const title = (text.match(/^# (.+)$/m) || [])[1] || f.replace(/\.md$/, "");
      const updated = (text.match(/updated: ([^|]+)/) || [])[1]?.trim() || "";
      const tags = (text.match(/tags: (.+)/) || [])[1]?.split(",").map((s) => s.trim()).filter(Boolean) || [];
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
export {
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
  readBench,
  rebuildWikiIndex,
  rewriteReport,
  rewriteText,
  rlabDir,
  search,
  suggestExternal,
  suggestZh,
  tokenize,
  topKeywords,
  wikiPath,
  writeWikiPage
};
