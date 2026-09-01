// src/index.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
import * as fs7 from "node:fs";
import * as path7 from "node:path";

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
import * as fs from "node:fs";
import * as path from "node:path";
var RLAB_DIR = ".rlab";
function rlabDir(project) {
  const abs = path.resolve(project);
  return path.join(abs, RLAB_DIR);
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
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
  return path.join(rlabDir(project), WIKI_DIR, kind, safe + ".md");
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
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, body, "utf8");
  const log = path.join(rlabDir(project), "wiki", "log.md");
  const stamp = (/* @__PURE__ */ new Date()).toISOString();
  fs.appendFileSync(log, "- " + stamp + "  " + page.kind + ":" + page.id + "  " + page.title.replace(/[\r\n]+/g, " ") + "\n", "utf8");
  return p;
}
function listWiki(project) {
  const root = path.join(rlabDir(project), WIKI_DIR);
  const pages = [];
  const kinds = ["experiment", "literature", "decision", "todo"];
  for (const kind of kinds) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const full = path.join(dir, f);
      const text = fs.readFileSync(full, "utf8");
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
  const idx = path.join(rlabDir(project), WIKI_DIR, "index.md");
  ensureDir(path.dirname(idx));
  fs.writeFileSync(idx, lines.join("\n") + "\n", "utf8");
  return idx;
}
function benchFile(project) {
  return path.join(rlabDir(project), "bench.jsonl");
}
function appendBench(project, row) {
  const file = benchFile(project);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
  return readBench(project);
}
function readBench(project) {
  const file = benchFile(project);
  if (!fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
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

// src/related.ts
import { DatabaseSync } from "node:sqlite";
import * as fs2 from "node:fs";
import * as path2 from "node:path";
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
  return path2.join(project, ".rlab", "related.db");
}
function openDb(project) {
  const dir = path2.dirname(dbPath(project));
  fs2.mkdirSync(dir, { recursive: true });
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
  const root = path2.resolve(dir);
  if (!fs2.existsSync(root)) return { added: 0, skipped: 0 };
  let added = 0, skipped = 0;
  const walk = (d, depth) => {
    if (depth > 4 || added >= maxFiles) return;
    for (const f of fs2.readdirSync(d, { withFileTypes: true })) {
      if (f.name.startsWith(".")) continue;
      const full = path2.join(d, f.name);
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
        const text = fs2.readFileSync(full, "utf8").slice(0, 2e4);
        const rel = path2.relative(root, full);
        addDoc(project, rel, text, "ingest:" + path2.basename(root));
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
import * as fs3 from "node:fs";
import * as path3 from "node:path";
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
var claimsFile = (project) => path3.join(project, ".rlab", "claims.jsonl");
function loadClaims(project) {
  try {
    const lines = fs3.readFileSync(claimsFile(project), "utf8").split("\n").filter(Boolean);
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
  fs3.mkdirSync(path3.dirname(claimsFile(project)), { recursive: true });
  for (const c of fresh) {
    const claim = { id: nextId++, docId, ...c, cited: 0, confidence: betaConfidence(prior, 0), date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) };
    fs3.appendFileSync(claimsFile(project), JSON.stringify(claim) + "\n", "utf8");
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
  fs3.writeFileSync(claimsFile(project), claims.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
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
  const head = (name2, n = 40) => {
    const f = path4.join(dir, name2);
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

// src/index.ts
import * as os2 from "node:os";

// src/ocr.ts
import * as fs5 from "node:fs";
import * as os from "node:os";
import * as path5 from "node:path";
var JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
var OCR_MODELS = ["PaddleOCR-VL-1.6", "PP-OCRv6"];
function ocrToken() {
  const fromEnv = process.env.PADDLE_OCR_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const f = path5.join(os.homedir(), ".dsh", "paddle-ocr.token");
  try {
    const t = fs5.readFileSync(f, "utf8").trim();
    if (t) return t;
  } catch {
  }
  throw new Error("PaddleOCR token not found \u2014 set env PADDLE_OCR_TOKEN or write it to " + f);
}
function bestPayload(model) {
  if (model === "PaddleOCR-VL-1.6") {
    return {
      useDocOrientationClassify: true,
      // rotated / portrait text
      useDocUnwarping: true,
      // curved/scan warping
      useLayoutDetection: true,
      // full layout analysis (titles/paragraphs/figures/tables)
      useChartRecognition: true,
      // charts incl. complex flow diagrams
      layoutDetModelName: "large",
      layoutShapeMode: "auto",
      showFormulaNumber: true,
      mergeTables: true,
      // cross-page table merge
      relevelTitles: true,
      // heading levels
      prettifyMarkdown: true,
      visualize: false
    };
  }
  return {
    useDocOrientationClassify: true,
    useDocUnwarping: true,
    useTextlineOrientation: true,
    textDetLimitSideLen: 128,
    // higher-res text detection (default 64)
    textDetLimitType: "min"
  };
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function submitLocal(abs, model, token) {
  const fd = new FormData();
  fd.append("model", model);
  fd.append("optionalPayload", JSON.stringify(bestPayload(model)));
  fd.append("file", new Blob([fs5.readFileSync(abs)]), path5.basename(abs));
  const resp = await fetch(JOB_URL, { method: "POST", headers: { Authorization: "bearer " + token }, body: fd });
  if (resp.status !== 200) throw new Error("submit failed " + resp.status + ": " + (await resp.text()).slice(0, 300));
  const j = await resp.json();
  return String(j.data.jobId);
}
var CT_EXT = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/bmp": "bmp", "image/tiff": "tiff" };
async function downloadToTemp(file) {
  const r = await fetch(file, { headers: { "User-Agent": "Mozilla/5.0 dsh-research-lab" } });
  if (!r.ok) throw new Error("download failed " + r.status);
  let name2 = path5.basename(new URL(file).pathname) || "doc";
  name2 = name2.replace(/[^\w.-]+/g, "-");
  const OK_EXT = ["pdf", "png", "jpg", "jpeg", "webp", "bmp", "tiff", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];
  const m = name2.match(/\.([a-z0-9]{2,5})$/i);
  const ext = m ? m[1].toLowerCase() : "";
  if (!OK_EXT.includes(ext)) {
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const cext = CT_EXT[ct];
    if (!cext) throw new Error("unsupported content-type from URL: " + ct);
    name2 = name2.replace(/\.[^.]*$/, "") + "." + cext;
  }
  const tmp = path5.join(os.tmpdir(), "rlab-ocr-" + Date.now() + "-" + name2);
  fs5.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  return tmp;
}
async function submitJob(file, model, token) {
  if (!/^https?:\/\//i.test(file)) {
    const abs = path5.resolve(file);
    if (!fs5.existsSync(abs)) throw new Error("file not found: " + abs);
    return submitLocal(abs, model, token);
  }
  const resp = await fetch(JOB_URL, {
    method: "POST",
    headers: { Authorization: "bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ fileUrl: file, model, optionalPayload: bestPayload(model) })
  });
  if (resp.status === 200) {
    const j = await resp.json();
    return String(j.data.jobId);
  }
  const tmp = await downloadToTemp(file);
  try {
    return await submitLocal(tmp, model, token);
  } finally {
    try {
      fs5.unlinkSync(tmp);
    } catch {
    }
  }
}
async function runOcr(file, model, opts = {}) {
  const token = opts.token ?? ocrToken();
  const started = Date.now();
  const jobId = await submitJob(file, model, token);
  const deadline = started + (opts.maxWaitMs ?? 3e5);
  while (Date.now() < deadline) {
    await sleep(opts.pollMs ?? 5e3);
    const r = await fetch(JOB_URL + "/" + jobId, { headers: { Authorization: "bearer " + token } });
    if (r.status !== 200) throw new Error("poll failed " + r.status + ": " + (await r.text()).slice(0, 200));
    const j = await r.json();
    const st = j.data.state;
    if (st === "done") {
      const url = j.data.resultUrl?.jsonUrl;
      if (!url) throw new Error("job done but no result jsonUrl");
      return { jobId, jsonlUrl: url, pages: j.data.extractProgress?.extractedPages ?? 0, ms: Date.now() - started };
    }
    if (st === "failed") throw new Error("OCR job failed: " + (j.data.errorMsg ?? "unknown error"));
  }
  throw new Error("OCR job timed out after " + Math.round((Date.now() - started) / 1e3) + "s (job " + jobId + ")");
}
async function fetchOcrMarkdown(jsonlUrl, outDir) {
  fs5.mkdirSync(outDir, { recursive: true });
  const r = await fetch(jsonlUrl);
  if (!r.ok) throw new Error("result download failed " + r.status);
  const parts = [];
  let images = 0, chars = 0;
  for (const line of r.text ? (await r.text()).split("\n").filter(Boolean) : []) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    for (const res of obj.result?.layoutParsingResults ?? []) {
      const md = res.markdown?.text ?? "";
      if (md) {
        parts.push(md);
        chars += md.length;
      }
      const imgs = res.markdown?.images ?? {};
      for (const [rel, url] of Object.entries(imgs)) {
        try {
          const ir = await fetch(url);
          if (ir.ok) {
            const p = path5.join(outDir, rel);
            fs5.mkdirSync(path5.dirname(p), { recursive: true });
            fs5.writeFileSync(p, Buffer.from(await ir.arrayBuffer()));
            images++;
          }
        } catch {
        }
      }
    }
  }
  if (!parts.length) throw new Error("no markdown content in OCR result");
  const mdPath = path5.join(outDir, "doc.md");
  const text = parts.join("\n\n---\n\n");
  fs5.writeFileSync(mdPath, text, "utf8");
  return { mdPath, pages: parts.length, images, chars, text };
}

// src/validate.ts
import * as fs6 from "node:fs";
import * as path6 from "node:path";
var KINDS = ["experiment", "literature", "decision", "todo"];
var REQUIRED_FIELDS = ["id", "kind", "title", "updated"];
function parseFrontmatter2(text) {
  if (!text.startsWith("---")) return { meta: {}, ok: false, err: "missing YAML frontmatter (must start with ---)" };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { meta: {}, ok: false, err: "unterminated frontmatter (missing closing ---)" };
  const block = text.slice(3, end).trim();
  const meta = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, ok: true };
}
function validateWiki(project) {
  const root = path6.join(rlabDir(project), "wiki");
  const issues = [];
  const graph = { edges: [], dangling: [], isolated: [] };
  const pages = listWiki(project);
  const idSet = new Set(pages.map((p) => p.id));
  for (const kind of KINDS) {
    const dir = path6.join(root, kind);
    if (!fs6.existsSync(dir)) continue;
    for (const f of fs6.readdirSync(dir)) {
      if (!f.endsWith(".md") || f === "index.md") continue;
      const full = path6.join(dir, f);
      const text = fs6.readFileSync(full, "utf8");
      const id = f.replace(/\.md$/, "");
      const fm = parseFrontmatter2(text);
      if (!fm.ok) {
        issues.push({ page: kind + "/" + id, severity: "error", message: fm.err });
        continue;
      }
      for (const field of REQUIRED_FIELDS) {
        if (!fm.meta[field]) issues.push({ page: kind + "/" + id, severity: "error", message: "frontmatter missing required field: " + field });
      }
      if (fm.meta.kind && !KINDS.includes(fm.meta.kind)) {
        issues.push({ page: kind + "/" + id, severity: "error", message: "invalid kind: " + fm.meta.kind });
      }
      if (fm.meta.id && fm.meta.id !== id) {
        issues.push({ page: kind + "/" + id, severity: "error", message: 'frontmatter id "' + fm.meta.id + '" != filename "' + id + '"' });
      }
      const links = [...text.matchAll(/\[\[([A-Za-z0-9_.-]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1]);
      for (const to of links) {
        if (idSet.has(to)) graph.edges.push({ from: id, to });
        else graph.dangling.push(id + " -> " + to);
      }
    }
  }
  const backlinks = /* @__PURE__ */ new Map();
  for (const e of graph.edges) backlinks.set(e.to, (backlinks.get(e.to) || 0) + 1);
  for (const p of pages) {
    const out = graph.edges.filter((e) => e.from === p.id).length;
    if (out === 0 && (backlinks.get(p.id) || 0) === 0) graph.isolated.push(p.id);
  }
  const lines = ["# Wiki validation \u2014 " + project, ""];
  lines.push("pages: " + pages.length + "   links: " + graph.edges.length + "   issues: " + issues.length);
  lines.push("");
  if (graph.dangling.length) {
    lines.push("## \u26A0\uFE0F dangling links (" + graph.dangling.length + ")");
    for (const d of graph.dangling.slice(0, 20)) lines.push("- " + d);
    lines.push("");
  }
  if (graph.isolated.length) {
    lines.push("## \u{1F3DD}\uFE0F isolated pages (no links in or out)");
    for (const i of graph.isolated.slice(0, 20)) lines.push("- " + i);
    lines.push("");
  }
  if (issues.length) {
    lines.push("## \u274C issues (" + issues.length + ")");
    for (const i of issues) lines.push("- [" + i.severity + "] " + i.page + ": " + i.message);
  } else {
    lines.push("## \u2705 all pages pass the \u03A9megaWiki contract");
  }
  lines.push("");
  lines.push("### top backlinked");
  const top = [...backlinks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [id, n] of top) lines.push("- " + id + "  (" + n + " backlinks)");
  return lines.join("\n");
}

// src/latex.ts
var PREAMBLE_ZH = [
  "\\documentclass[11pt,a4paper]{article}",
  "\\usepackage[UTF8]{ctex}",
  "\\usepackage{geometry}",
  "\\geometry{left=3.00cm,right=2.75cm,top=2.63cm,bottom=2.96cm}",
  "\\usepackage{amsmath,amssymb,amsfonts,bm}",
  "\\usepackage{graphicx,booktabs,multirow,array}",
  "\\usepackage{hyperref}",
  "\\CJKsetecglue{\\hskip 0.15em plus 0.05em minus 0.05em}",
  "\\setlength{\\parindent}{2em} \\usepackage{indentfirst}"
].join("\n");
var TITLES = {
  "paper-zh": "\u4E2D\u6587\u8BBA\u6587",
  "thesis-zh": "\u5B66\u4F4D\u8BBA\u6587",
  "nsfc-zh": "\u57FA\u91D1\u7533\u8BF7\u4E66",
  "paper-en": "English Paper"
};
var BODY = {
  "paper-zh": "\\section{\u5F15\u8A00}\n\\section{\u65B9\u6CD5}\n\\section{\u5B9E\u9A8C}\n\\section{\u7ED3\u8BBA}",
  "thesis-zh": "\\chapter{\u7EEA\u8BBA}\n\\chapter{\u76F8\u5173\u5DE5\u4F5C}\n\\chapter{\u65B9\u6CD5}\n\\chapter{\u5B9E\u9A8C\u4E0E\u8BA8\u8BBA}\n\\chapter{\u7ED3\u8BBA\u4E0E\u5C55\u671B}",
  "nsfc-zh": "\\section{\u7ACB\u9879\u4F9D\u636E}\n\\section{\u7814\u7A76\u5185\u5BB9\u4E0E\u76EE\u6807}\n\\section{\u7814\u7A76\u65B9\u6848\u4E0E\u6280\u672F\u8DEF\u7EBF}\n\\section{\u521B\u65B0\u70B9}",
  "paper-en": "\\section{Introduction}\n\\section{Method}\n\\section{Experiments}\n\\section{Conclusion}"
};
function genLatex(kind, meta = {}) {
  const zh = kind !== "paper-en";
  const lines = [];
  lines.push("% rlab_latex: " + TITLES[kind] + " skeleton (XeLaTeX)");
  lines.push(PREAMBLE_ZH);
  lines.push("\\title{" + (meta.title ?? "\u5F85\u5B9A\u6807\u9898") + "}");
  lines.push("\\author{" + (meta.author ?? "\u4F5C\u8005") + (meta.affiliation ? "\\thanks{" + meta.affiliation + "}" : "") + "}");
  lines.push("\\date{\\today}");
  lines.push("\\begin{document}");
  lines.push("\\maketitle");
  if (meta.abstract) lines.push((zh ? "\\begin{abstract}" : "\\begin{abstract}") + meta.abstract + (zh ? "\\end{abstract}" : "\\end{abstract}"));
  if (meta.keywords) lines.push("\\noindent\\textbf{" + (zh ? "\u5173\u952E\u8BCD" : "Keywords") + ":} " + meta.keywords);
  lines.push(BODY[kind]);
  if (meta.extra) lines.push(meta.extra);
  lines.push("\\end{document}");
  return lines.join("\n");
}
function lintLatex(text) {
  const issues = [];
  if (!/\\documentclass/.test(text)) issues.push("\u26A0\uFE0F \u7F3A\u5C11 \\documentclass");
  if (/[""„“”]/.test(text)) issues.push("\u26A0\uFE0F \u53D1\u73B0\u76F4\u5F15\u53F7/\u5F2F\u5F15\u53F7\u6DF7\u7528: \u4E2D\u6587\u5E94\u4F7F\u7528 \u201C \u201D \u6216 \u201C\u201D \u5168\u89D2\u5F15\u53F7");
  const b = (text.match(/\\begin\{([a-z*]+)\}/g) ?? []).map((s) => s.replace(/\\begin\{(.+)\}/, "$1"));
  const e = (text.match(/\\end\{([a-z*]+)\}/g) ?? []).map((s) => s.replace(/\\end\{(.+)\}/, "$1"));
  for (const env of /* @__PURE__ */ new Set([...b, ...e])) {
    const nb = b.filter((x) => x === env).length, ne = e.filter((x) => x === env).length;
    if (nb !== ne) issues.push("\u274C begin/end \u4E0D\u914D\u5BF9: " + env + " (" + nb + "/" + ne + ")");
  }
  const ds = (text.match(/\$/g) ?? []).length;
  if (ds % 2 !== 0) issues.push("\u274C $ \u6570\u91CF\u4E3A\u5947\u6570 (" + ds + "), \u6570\u5B66\u6A21\u5F0F\u672A\u95ED\u5408");
  if (text.includes("\\citep{") || text.includes("\\cite{")) issues.push("\u2139\uFE0F \u5F15\u7528\u5EFA\u8BAE\u4F7F\u7528 biblatex: \\addbibresource + \\parencite");
  if (text.includes("  ")) issues.push("\u2139\uFE0F \u5B58\u5728\u8FDE\u7EED\u7A7A\u683C (TeX \u4F1A\u6298\u53E0, \u5EFA\u8BAE\u68C0\u67E5)");
  return issues.length ? issues.join("\n") : "\u2705 \u672A\u53D1\u73B0\u660E\u663E\u95EE\u9898";
}
var LATEX_KINDS = ["paper-zh", "thesis-zh", "nsfc-zh", "paper-en"];

// src/index.ts
var textOut = { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: String(v) }] };
var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var name = "dsh-research-lab";
var inject = ["tools"];
async function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "rlab_validate",
    description: "Validate a research-wiki against the \u03A9megaWiki contract: frontmatter schema (id/kind/title/updated), kind legality, id-filename consistency, [[wikilink]] bidirectional graph, dangling and isolated pages. Run after rlab_wiki batches or before publishing.".replace(/ΩmegaWiki contract/, "\u03A9megaWiki contract"),
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" }
    },
    output: textOut,
    timeoutMs: 15e3,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      if (!project) throw new Error("project required");
      return validateWiki(project);
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_latex",
    description: "Scaffold a Chinese/English research LaTeX document (paper/thesis/NSFC skeleton with ctex + xeCJK preamble) or lint an existing .tex for common issues (unpaired begin/end, odd dollar count, quote style). Zero-dependency pure template registry (hono-style).".replace(/hono-style/, "hono-style"),
    parameters: {
      kind: { type: "string", required: true, description: "paper-zh | thesis-zh | nsfc-zh | paper-en" },
      title: { type: "string", description: "document title" },
      author: { type: "string", description: "author name" },
      affiliation: { type: "string", description: "affiliation (as \\thanks)" },
      keywords: { type: "string", description: "comma-separated keywords" },
      abstract: { type: "string", description: "abstract text" },
      text: { type: "string", description: "existing .tex content to lint (when set, lints instead of generating)" }
    },
    output: textOut,
    timeoutMs: 15e3,
    async execute(args) {
      const kind = String(args?.kind ?? "").trim();
      const text = String(args?.text ?? "").trim();
      if (text) return lintLatex(text);
      if (!LATEX_KINDS.includes(kind)) throw new Error("kind must be one of: " + LATEX_KINDS.join(", "));
      return genLatex(kind, { title: args?.title, author: args?.author, affiliation: args?.affiliation, keywords: args?.keywords, abstract: args?.abstract });
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_wiki",
    description: "Write a research-wiki page under <project>/.rlab/wiki/<kind>/ and rebuild the index (AutoSci-style durable lab notes). Kinds: experiment (what you ran), literature (paper notes), decision (why you chose X \u2014 ADRs), todo (open items). Pages are plain markdown; read them with the read tool. Returns the written path.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" },
      kind: { type: "string", required: true, description: "experiment | literature | decision | todo" },
      id: { type: "string", required: true, description: "short kebab id, e.g. m10-contrastive or arxiv-2602.04770" },
      title: { type: "string", required: true, description: "page title" },
      content: { type: "string", required: true, description: "markdown body" },
      tags: { type: "array", description: "optional tags" }
    },
    output: textOut,
    timeoutMs: 15e3,
    async execute(args) {
      const kind = String(args?.kind ?? "");
      if (!["experiment", "literature", "decision", "todo"].includes(kind)) throw new Error("kind must be experiment|literature|decision|todo");
      const project = String(args?.project ?? "").trim();
      const id = String(args?.id ?? "").trim();
      if (!project || !id) throw new Error("project and id required");
      const p = writeWikiPage(project, {
        kind,
        id,
        title: String(args?.title ?? id),
        updated: today(),
        content: String(args?.content ?? ""),
        tags: args?.tags
      });
      const idx = rebuildWikiIndex(project);
      let ix = "";
      try {
        addDoc(project, "wiki/" + kind + "/" + id, String(args?.title ?? id) + "\n\n" + String(args?.content ?? ""), "wiki");
        ix = "\nIndexed into related.db \u2014 now searchable via rlab_related.";
      } catch {
        ix = "\n(related.db index skipped \u2014 db unavailable)";
      }
      return "Wrote " + p + "\nIndex: " + idx + ix;
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_bench",
    description: "Append one evaluation row to the per-project benchmark ledger (<project>/.rlab/bench.jsonl) and return the report. ASI-Bench-grade rigor: you MUST state metric, split and (for MTEB) hf_subset \u2014 the tool flags \u53E3\u5F84 (protocol) mismatches, e.g. comparing test vs dev splits, which is the classic self-deception in ML papers.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" },
      model: { type: "string", required: true, description: "model id, e.g. driftnet-m9 or potion-multilingual-128M" },
      task: { type: "string", required: true, description: "task name, e.g. STS12 or MTEB-Multilingual-v2" },
      score: { type: "number", required: true, description: "the metric value" },
      metric: { type: "string", required: true, description: "cos_sim.spearman | ndcg_at_10 | accuracy | ..." },
      split: { type: "string", description: "test | dev | validation (default test)" },
      hf_subset: { type: "string", description: "huggingface subset when task has one" },
      prompt_type: { type: "string", description: "e.g. query|passage, or none" },
      seed: { type: "number", description: "seed if stochastic" },
      note: { type: "string", description: 'free note, e.g. "batch 128, fp32, compile off"' }
    },
    output: textOut,
    timeoutMs: 1e4,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      const model = String(args?.model ?? "").trim();
      const task = String(args?.task ?? "").trim();
      const score = Number(args?.score);
      if (!project || !model || !task || Number.isNaN(score)) throw new Error("project/model/task/score required");
      const row = {
        date: today(),
        model,
        task,
        score,
        metric: String(args?.metric ?? "score"),
        split: String(args?.split ?? "test"),
        hf_subset: args?.hf_subset ? String(args.hf_subset) : void 0,
        prompt_type: args?.prompt_type ? String(args.prompt_type) : void 0,
        seed: args?.seed !== void 0 ? Number(args.seed) : void 0,
        note: args?.note ? String(args.note) : void 0
      };
      appendBench(project, row);
      return benchReport(project, model, task);
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_experiment",
    description: "Write an experiment page with a verdict-driven structure (hypothesis \u2192 prediction \u2192 evidence \u2192 verdict \u2192 conclusion). This encodes the discipline we learned the hard way: every experiment states its decision rule BEFORE the run, and records negative results with the same weight as positive ones. Page goes to <project>/.rlab/wiki/experiment/<id>.md.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" },
      id: { type: "string", required: true, description: "short kebab id, e.g. v4-permcons" },
      hypothesis: { type: "string", required: true, description: "what you believed and why (with references)" },
      prediction: { type: "string", description: 'falsifiable prediction + decision rule, e.g. "STS12 >= 0.5 \u2192 mechanism works"' },
      evidence: { type: "string", required: true, description: "what actually happened: numbers, logs, artifacts" },
      verdict: { type: "string", required: true, description: "confirmed | refuted | inconclusive" },
      conclusion: { type: "string", required: true, description: "what this changes for the project" }
    },
    output: textOut,
    timeoutMs: 15e3,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      const id = String(args?.id ?? "").trim();
      const verdict = String(args?.verdict ?? "");
      if (!project || !id) throw new Error("project and id required");
      if (!["confirmed", "refuted", "inconclusive"].includes(verdict)) throw new Error("verdict must be confirmed|refuted|inconclusive");
      const body = [
        "## Hypothesis",
        "",
        String(args?.hypothesis ?? ""),
        "",
        "## Prediction / decision rule",
        "",
        String(args?.prediction ?? "(not stated \u2014 bad practice)"),
        "",
        "## Evidence",
        "",
        String(args?.evidence ?? ""),
        "",
        "## Verdict: **" + verdict.toUpperCase() + "**",
        "",
        "## Conclusion",
        "",
        String(args?.conclusion ?? ""),
        ""
      ].join("\n");
      const p = writeWikiPage(project, { kind: "experiment", id, title: id + " \u2014 " + verdict, updated: today(), content: body });
      const idx = rebuildWikiIndex(project);
      return "Wrote " + p + "\nIndex: " + idx;
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_paper_review",
    description: "Pull an arXiv paper by id (or abs URL) and produce a structured adversarial review checklist (ChatPaper summary + ASI-Bench rigor): contribution, method, evidence strength, baseline fairness, flaws, reproducibility. The checklist is the same one you should apply to your OWN paper before submission.",
    parameters: {
      arxivId: { type: "string", required: true, description: "e.g. 2602.04770 or full https://arxiv.org/abs/2602.04770 URL" },
      focus: { type: "string", description: 'what to look for, e.g. "is the eval protocol sound?"' },
      outputFile: { type: "string", description: "optional absolute path to write the review markdown" }
    },
    output: textOut,
    timeoutMs: 6e4,
    async execute(args) {
      const raw = String(args?.arxivId ?? "").trim();
      const m = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/);
      if (!m) throw new Error("could not parse arXiv id from: " + raw);
      const papers = await arxivByIds([m[1]]);
      if (!papers.length) throw new Error("paper not found: " + m[1]);
      const p = papers[0];
      const focus = args?.focus ? String(args.focus) : "";
      const lines = [
        "# Review: " + p.title,
        "",
        "arXiv: " + p.id + "  |  " + p.absUrl,
        "Authors: " + p.authors.join(", "),
        "Published: " + p.published.slice(0, 10) + (p.updated && p.updated !== p.published ? " (updated " + p.updated.slice(0, 10) + ")" : ""),
        "Categories: " + p.categories.join(", "),
        "",
        "## Abstract",
        "",
        p.summary,
        "",
        focus ? "## Review focus: " + focus : "",
        "",
        "## Checklist (answer each)",
        "",
        "1. **Contribution** \u2014 what is new vs prior work? Is the novelty structural or incremental?",
        "2. **Method** \u2014 is the method fully specified (hyperparams, data splits, compute)? Could you reimplement it from the text alone?",
        "3. **Evidence strength** \u2014 are the reported numbers backed by: same eval protocol across baselines? error bars / seeds? statistical tests?",
        "4. **Baseline fairness** \u2014 same preprocessing, same prompt templates, same split, same metric? Any cherry-picked subsets?",
        "5. **Known failure modes** \u2014 contamination (eval data in training), leakage, train/test split integrity, metric misuse (e.g. Pearson vs Spearman, accuracy on imbalanced sets).",
        "6. **Reproducibility** \u2014 code/data released? licenses? hardware and runtime reported?",
        "7. **Claims vs evidence** \u2014 does every headline claim have a corresponding table/figure with the exact protocol?",
        "8. **Missing experiments** \u2014 what ablation or control would you require before believing the central claim?",
        "",
        "## Verdict draft",
        "",
        "- [ ] Accept (strong evidence, sound protocol)",
        "- [ ] Weak accept (interesting but under-verified)",
        "- [ ] Borderline (fixable flaws: missing ablations, protocol gaps)",
        "- [ ] Reject (fatal flaw: broken protocol, no baseline, claims exceed evidence)",
        "",
        "_Generated by dsh-research-lab \u2014 the checklist also applies to your own papers._"
      ];
      const text = lines.join("\n");
      const outFile = args?.outputFile ? String(args.outputFile) : "";
      if (outFile) {
        fs7.mkdirSync(path7.dirname(path7.resolve(outFile)), { recursive: true });
        fs7.writeFileSync(outFile, text + "\n", "utf8");
        return "Review written to " + outFile + "\n\n" + text;
      }
      return text;
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_arxiv_digest",
    description: "Keyword digest of recent arXiv papers (daily-arXiv-ai-enhanced style). Searches export.arxiv.org for each query, dedupes, sorts by date, and writes a markdown digest under <project>/.rlab/digests/<date>.md. Use with rlab_wiki literature pages to build your reading queue.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" },
      queries: { type: "array", required: true, description: 'search terms, e.g. ["embedding distillation", "efficient retrieval"]' },
      maxPerQuery: { type: "number", description: "papers per query (default 10, max 30)" },
      withSummary: { type: "boolean", description: "include 500-char abstracts (default false)" },
      wiki: { type: "boolean", description: "also write every paper as a literature wiki page and index into related.db (default false)" }
    },
    output: textOut,
    timeoutMs: 12e4,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      const queries = Array.isArray(args?.queries) ? args.queries.map(String).filter(Boolean) : [];
      if (!project || !queries.length) throw new Error("project and queries required");
      const max = Math.min(Number(args?.maxPerQuery) || 10, 30);
      const withSummary = args?.withSummary === true;
      const seen = /* @__PURE__ */ new Set();
      const all = [];
      for (const q of queries) {
        try {
          const papers = await arxivSearch(q, max);
          for (const p of papers) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            all.push(p);
          }
        } catch (e) {
          all.push({ id: "ERR", title: "query failed: " + q + " \u2014 " + e.message, authors: [], published: "", updated: "", summary: "", categories: [], absUrl: "", pdfUrl: "" });
        }
      }
      all.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
      const date = today();
      const dir = path7.join(rlabDir(project), "digests");
      fs7.mkdirSync(dir, { recursive: true });
      const file = path7.join(dir, date + ".md");
      const lines = ["# arXiv digest \u2014 " + date, "", "queries: " + queries.join(" | "), "papers: " + all.length, ""];
      lines.push(formatPapers(all, withSummary));
      fs7.writeFileSync(file, lines.join("\n") + "\n", "utf8");
      let wikiCount = 0;
      if (args?.wiki === true) {
        const wseen = /* @__PURE__ */ new Set();
        for (const p of all) {
          if (!p.id || p.id === "ERR" || wseen.has(p.id)) continue;
          wseen.add(p.id);
          try {
            const slug = p.id.replace(/[^\w-]+/g, "").slice(0, 60);
            const content = "## Title\n" + p.title + "\n\n## Authors\n" + (p.authors || []).join(", ").slice(0, 300) + "\n\n## Abstract\n" + (p.summary || "").slice(0, 1200) + "\n\n## Links\n- " + (p.absUrl || "") + "\n- " + (p.pdfUrl || "");
            writeWikiPage(project, { kind: "literature", id: slug, title: String(p.title).slice(0, 120), updated: today(), content, tags: ["arxiv", ...(p.categories || []).slice(0, 3)] });
            addDoc(project, "wiki/literature/" + slug, String(p.title) + "\n\n" + (p.summary || ""), "arxiv:" + p.id);
            wikiCount++;
          } catch {
          }
        }
      }
      return "Digest written to " + file + " (" + all.length + " papers" + (wikiCount ? ", " + wikiCount + " wiki pages written" : "") + ")\n\n" + formatPapers(all.slice(0, 10), withSummary);
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_writing",
    description: "Academic-expression check on a passage (nature-skills / research-writing-skill style). Flags: passive-voice overuse, weak verbs (get/do/make/use), vague quantifiers (many/some/very), overlong sentences, filler phrases, and inconsistent terminology. Returns a line-anchored report with concrete rewrites.",
    parameters: {
      text: { type: "string", required: true, description: "the passage to check" }
    },
    output: textOut,
    timeoutMs: 15e3,
    async execute(args) {
      const text = String(args?.text ?? "").trim();
      if (!text) throw new Error("text required");
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      const weakVerbs = /\b(get|got|do|does|did|make|makes|made|use|uses|used|put|take|takes|took|show|shows|showed)\b/gi;
      const vague = /\b(many|some|several|a lot of|lots of|very|really|quite|fairly|pretty|kind of|sort of|basically|essentially|important|interesting|significant)\b/gi;
      const filler = /\b(in order to|due to the fact that|at this point in time|it is important to note that|as we all know|needless to say|it should be noted that)\b/gi;
      const passive = /\b(was|were|is|are|been|being) \w+ed\b/gi;
      const issues = [];
      const seen = /* @__PURE__ */ new Set();
      const push = (s) => {
        if (!seen.has(s)) {
          seen.add(s);
          issues.push(s);
        }
      };
      for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i];
        const words = s.split(/\s+/).length;
        if (words > 40) push("S" + (i + 1) + " [" + words + ' words] overlong sentence \u2014 split it: "' + s.slice(0, 90) + '\u2026"');
        const wv = s.match(weakVerbs);
        if (wv) push("S" + (i + 1) + " weak verb(s) " + [...new Set(wv.map((x) => x.toLowerCase()))].join(", ") + ' \u2014 prefer precise verbs: "' + s.slice(0, 80) + '"');
        const vq = s.match(vague);
        if (vq) push("S" + (i + 1) + " vague quantifier(s) " + [...new Set(vq.map((x) => x.toLowerCase()))].join(", ") + ' \u2014 replace with numbers or drop: "' + s.slice(0, 80) + '"');
        const fl = s.match(filler);
        if (fl) push("S" + (i + 1) + " filler: " + fl[0].toLowerCase() + ' \u2192 "' + s.slice(0, 80) + '"');
        const ps = s.match(passive);
        if (ps && words > 12) push("S" + (i + 1) + " passive " + ps[0].toLowerCase() + ' \u2014 consider active voice: "' + s.slice(0, 80) + '"');
      }
      const terms = text.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [];
      const freq = /* @__PURE__ */ new Map();
      for (const t of terms) freq.set(t, (freq.get(t) || 0) + 1);
      const multi = [...freq.entries()].filter(([, n]) => n >= 3).map(([t]) => t);
      const report = [
        "# Writing check report",
        "",
        "Sentences: " + sentences.length + " | issues found: " + issues.length,
        "",
        issues.length ? issues.map((x) => "- " + x).join("\n") : "- \u2705 No common issues detected.",
        "",
        multi.length ? "## Repeated key terms (check spelling/consistency): " + multi.join(", ") : "",
        "",
        "## Quick checklist",
        "",
        "- One idea per sentence; < 30 words ideal.",
        '- Active voice: "we train" not "it was trained".',
        '- Numbers over adjectives: "57% (n=1,204)" not "many".',
        "- Define acronyms at first use; use ONE name per concept everywhere.",
        "- Claim only what a table/figure with a stated protocol supports."
      ].join("\n");
      return report;
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_rewrite",
    description: 'Deterministic academic-writing rewrite engine (w-engine rules.ts spirit): applies ~10 curated rules \u2014 filler deletion (in order to\u2192to, due to the fact that\u2192because), weak verbs (get\u2192obtain, make\u2192produce, use\u2192employ), passive "was X-ed by Y"\u2192active, nominalizations, vague hedges. Returns before/after + per-rule hit counts. Offline, predictable, cheaper than LLM polishing.',
    parameters: {
      text: { type: "string", required: true, description: "the passage to rewrite" }
    },
    output: textOut,
    timeoutMs: 1e4,
    async execute(args) {
      const text = String(args?.text ?? "").trim();
      if (!text) throw new Error("text required");
      return rewriteReport(text);
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_claim",
    description: "Claim ledger with evidence confidence (w8 knowledge.ts/betaConfidence spirit). extract: pull structured claims (contribution/result/comparison \u2014 en+zh templates) from text or an indexed doc and append to <project>/.rlab/claims.jsonl with beta-posterior confidence (prior 0.5, weight 100). cite: increment citations of a claim \u2192 confidence rises. list: show the ledger. This is the evidence backbone for Related Work claims in your paper.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" },
      action: { type: "string", required: true, description: "extract | cite | list" },
      text: { type: "string", description: "paper text to extract from (action=extract)" },
      docId: { type: "number", description: "indexed doc id to extract from (action=extract)" },
      claimId: { type: "number", description: "claim id to cite (action=cite)" },
      type: { type: "string", description: "filter list by claim type" }
    },
    output: textOut,
    timeoutMs: 2e4,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      const action = String(args?.action ?? "").trim();
      if (!project || !action) throw new Error("project and action required");
      switch (action) {
        case "extract": {
          let docId = 0;
          let textArg = String(args?.text ?? "");
          if (args?.docId !== void 0) {
            docId = Number(args.docId);
            const db = openDb(project);
            const row = db.prepare("SELECT title, body FROM docs WHERE id=?").get(docId);
            if (!row) throw new Error("doc #" + docId + " not found \u2014 index it with rlab_related action=add first");
            textArg = row.title + " " + row.body;
          }
          if (!textArg.trim()) throw new Error("text or docId required");
          const added = addClaims(project, docId, textArg);
          if (!added.length) return 'No claims matched the templates in this text. Templates: "we propose/present X", "achieves Y on Z", "outperforms W by V" (en+zh).';
          return "Extracted " + added.length + " claims (confidences beta(0.5, cited=0)):\n\n" + added.map((c) => "[" + c.id + "] " + c.type.toUpperCase() + " conf=" + c.confidence.toFixed(3) + "\n  subject: " + (c.subject || "\u2014") + (c.value ? "  value: " + c.value : "") + (c.task ? "  on: " + c.task : "")).join("\n");
        }
        case "cite": {
          const claimId = Number(args?.claimId);
          if (!claimId) throw new Error("claimId required");
          const c = citeClaim(project, claimId);
          if (!c) throw new Error("claim #" + claimId + " not found");
          return "Cited claim #" + claimId + " \u2014 confidence " + c.confidence.toFixed(4) + " (cited=" + c.cited + "). beta posterior rises with each citation.";
        }
        case "list":
          return claimsReport(project, args?.type ? String(args.type) : void 0);
        default:
          throw new Error("action must be extract|cite|list");
      }
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_ref",
    description: "Shallow-clone a public GitHub repo and auto-generate a study note (REF.md): README/CLAUDE.md excerpts, 2-level tree, file count, absorption-decision table to fill in. The zero-config research habit: new reference project -> study note in seconds. Also indexable via rlab_related ingest.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root (refs go to <project>/.rlab/refs/)" },
      url: { type: "string", required: true, description: "github.com URL, e.g. https://github.com/skyllwt/AutoSci" }
    },
    output: textOut,
    timeoutMs: 15e4,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      const url = String(args?.url ?? "").trim();
      if (!project || !url) throw new Error("project and url required");
      const res = cloneAndStudy(url, path7.join(rlabDir(project), "refs"));
      return "Cloned " + res.repo + " -> " + res.dir + " (" + res.files + " files)" + String.fromCharCode(10) + "Study note: " + res.noteFile + String.fromCharCode(10) + String.fromCharCode(10) + "## README excerpt" + String.fromCharCode(10) + res.readme.slice(0, 400) + String.fromCharCode(10) + String.fromCharCode(10) + "## Structure" + String.fromCharCode(10) + res.tree.slice(0, 15).join(String.fromCharCode(10));
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_related",
    description: "Self-building keyword retrieval over a project document store (NLP + SQLite FTS5, zero deps). NO preset lexicon: terms are mined from the corpus via TF-IDF (English words + Chinese n-grams) and the lexicon grows with every added doc. Actions: add (index a doc), search (FTS5), expand (iterative relevance feedback: search \u2192 mine new terms from top hits \u2192 merge into query \u2192 repeat, rounds=1..4), keywords (show the auto-built lexicon), list (all docs). DB at <project>/.rlab/related.db.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" },
      action: { type: "string", required: true, description: "add | search | expand | keywords | list | ingest" },
      title: { type: "string", description: "doc title (add)" },
      body: { type: "string", description: "doc body/text (add)" },
      source: { type: "string", description: "origin, e.g. arxiv:2602.04770 or file path (add)" },
      query: { type: "string", description: "search query (search/expand), plain words, zh or en" },
      k: { type: "number", description: "results per round (default 8, max 20)" },
      rounds: { type: "number", description: "expansion rounds (default 2, max 4)" },
      external: { type: "boolean", description: "also mine suggestion terms from Wikipedia opensearch (en+zh, network; degrades silently offline)" },
      topN: { type: "number", description: "lexicon size for keywords (default 30)" },
      dir: { type: "string", description: "directory to bulk-ingest (ingest). Default: auto-detect .dsh-lib-analyzer/pages, .rlab/wiki, batch/out" }
    },
    output: textOut,
    timeoutMs: 6e4,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      const action = String(args?.action ?? "").trim();
      if (!project || !action) throw new Error("project and action required");
      const k = Math.min(Number(args?.k) || 8, 20);
      const rounds = Math.min(Number(args?.rounds) || 2, 4);
      const topN = Number(args?.topN) || 30;
      const fmt = (ds) => ds.map((d) => "\u2022 [" + d.id + "] " + d.title + (d.source ? "  (" + d.source + ")" : "") + "  " + d.added + "\n  " + d.body.slice(0, 200).replace(/\n/g, " ")).join("\n");
      switch (action) {
        case "add": {
          const title = String(args?.title ?? "").trim();
          const body = String(args?.body ?? "").trim();
          if (!title || !body) throw new Error("title and body required for add");
          const id = addDoc(project, title, body, String(args?.source ?? ""));
          const kw = mineKeywords(project, 15);
          return "Indexed doc #" + id + ": " + title + "\nLexicon now " + kw.length + " top terms: " + kw.slice(0, 10).map((x) => x.term + "(" + x.score.toFixed(2) + ")").join(", ");
        }
        case "search": {
          const q = String(args?.query ?? "").trim();
          if (!q) throw new Error("query required for search");
          const hits = search(project, q, k);
          if (!hits.length) return "No hits for: " + q + "\nTry expand (iterative keyword mining) or add more docs.";
          return "FTS5 hits (" + hits.length + ") for: " + q + "\n\n" + fmt(hits);
        }
        case "expand": {
          const q = String(args?.query ?? "").trim();
          if (!q) throw new Error("query required for expand");
          let res = expandSearch(project, q, rounds, k);
          if (args?.external === true) {
            const ext = (await suggestExternal(q, 4)).concat(await suggestZh(q, 4));
            const extTerms = ext.map((e) => e.term + "[" + e.source + "]").join(", ");
            if (ext.length) {
              const extHits = hybridSearch(project, ext.map((e) => e.term).join(" OR "), k);
              res = { ...res, rounds: res.rounds.concat([{ round: res.rounds.length + 1, newTerms: ext.map((e) => e.term), hits: extHits }]), final: extHits.length ? extHits : res.final };
            }
            return "Iterative expansion (with external suggestions): " + q + "\n  external terms: " + (ext.length ? extTerms : "(none \u2014 offline?)") + "\n\n" + fmt(res.final);
          }
          const lines = ["Iterative expansion for: " + q + "  (rounds=" + res.rounds.length + ")", ""];
          for (const rr of res.rounds) {
            lines.push("round " + rr.round + ": " + rr.hits.length + " hits" + (rr.newTerms.length ? "  \u2192 mined new terms: " + rr.newTerms.join(", ") : "  \u2192 lexicon saturated"));
          }
          lines.push("", "## Final hits", fmt(res.final));
          lines.push("", "## Auto-built lexicon (top " + res.lexicon.length + ")", res.lexicon.slice(0, 15).map((x) => x.term + "  score=" + x.score.toFixed(2) + " freq=" + x.freq + " docs=" + x.docs).join("\n"));
          return lines.join("\n");
        }
        case "ingest": {
          const dir = String(args?.dir ?? "").trim();
          const cands = dir ? [dir] : [path7.join(project, ".dsh-lib-analyzer", "pages"), path7.join(project, ".rlab", "wiki"), path7.join(project, "batch", "out")];
          const parts = [];
          let total = 0, skipped = 0;
          for (const cdir of cands) {
            if (!fs7.existsSync(cdir)) {
              if (dir) throw new Error("dir not found: " + cdir);
              continue;
            }
            const res = ingestDocDir(project, cdir);
            total += res.added;
            skipped += res.skipped;
            parts.push(path7.basename(cdir) + ":+" + res.added);
          }
          return "Ingested " + total + " files (skipped " + skipped + ") \u2014 " + (parts.join(" | ") || "(no ingest dirs found \u2014 pass dir=)") + "\nLexicon updated automatically. Try search or expand now.";
        }
        case "keywords": {
          const kw = topKeywords(project, topN);
          if (!kw.length) return "Lexicon empty \u2014 add docs first (rlab_related action=add).";
          return "Auto-built lexicon (" + kw.length + "):\n" + kw.map((x) => x.term + "  score=" + x.score.toFixed(2) + " freq=" + x.freq + " docs=" + x.docs + "  seen=" + x.last_seen).join("\n");
        }
        case "list": {
          const db = openDb(project);
          const rows = db.prepare("SELECT id, title, source, added FROM docs ORDER BY id DESC LIMIT 50").all();
          if (!rows.length) return "No docs indexed yet.";
          return "Docs (" + rows.length + "):\n" + rows.map((x) => "\u2022 #" + x.id + " " + x.title + (x.source ? "  (" + x.source + ")" : "") + "  " + x.added).join("\n");
        }
        default:
          throw new Error("action must be add|search|expand|keywords|list|ingest");
      }
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_ocr",
    description: "Submit a document (local file path or http(s) URL) to PaddleOCR cloud and auto-ingest it into the research lab: downloads markdown + images into <project>/ocr/<name>/, indexes into related.db, optionally writes a literature wiki page. Models: PaddleOCR-VL-1.6 (all-round: complex layouts, flow charts) | PP-OCRv6 (light: fixed charts). Quality-max params enabled. Token from env PADDLE_OCR_TOKEN or ~/.dsh/paddle-ocr.token (never hardcoded). Free quota 20000 pages/day per model.",
    parameters: {
      file: { type: "string", required: true, description: "local file path or http(s) URL of the document (PDF/PNG/JPG...) to OCR" },
      model: { type: "string", description: "PaddleOCR-VL-1.6 (default, all-round) | PP-OCRv6 (light)" },
      project: { type: "string", description: "research project root \u2014 used for outDir/index/wiki (optional)" },
      outDir: { type: "string", description: "output dir for markdown+images (default <project>/ocr/<name>/ or ~/dsh-ocr/<name>/)" },
      index: { type: "boolean", description: "index the markdown into related.db (default true)" },
      wiki: { type: "boolean", description: "also write a literature wiki page (default false)" },
      maxWaitMs: { type: "number", description: "job poll timeout in ms (default 300000)" }
    },
    output: textOut,
    timeoutMs: 6e5,
    async execute(args) {
      const file = String(args?.file ?? "").trim();
      if (!file) throw new Error("file required (local path or http(s) URL)");
      const model = String(args?.model ?? "PaddleOCR-VL-1.6").trim();
      if (!OCR_MODELS.includes(model)) throw new Error("model must be " + OCR_MODELS.join(" | "));
      const project = String(args?.project ?? "").trim();
      const t0 = Date.now();
      const job = await runOcr(file, model, { maxWaitMs: Number(args?.maxWaitMs) || 3e5 });
      const base = path7.basename(file).replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fff-]+/g, "-").slice(0, 60) || "doc";
      const outDir = String(args?.outDir ?? "").trim() || (project ? path7.join(project, "ocr", base) : path7.join(os2.homedir(), "dsh-ocr", base));
      const md = await fetchOcrMarkdown(job.jsonlUrl, outDir);
      const lines = [
        "\u2705 OCR done: " + file,
        "model: " + model + "  pages: " + md.pages + "  chars: " + md.chars + "  images: " + md.images + "  time: " + Math.round((Date.now() - t0) / 1e3) + "s",
        "md: " + md.mdPath
      ];
      if (project && args?.index !== false) {
        const id = addDoc(project, "ocr/" + base + "/doc.md", md.text, "paddleocr:" + model);
        lines.push("indexed into related.db: doc #" + id);
      }
      if (project && args?.wiki === true) {
        const p = writeWikiPage(project, { kind: "literature", id: base, title: base + " (OCR)", updated: today(), content: md.text.slice(0, 4e3) + "\n\n---\nSource: " + file + " (PaddleOCR " + model + ")", tags: ["ocr"] });
        lines.push("wiki page: " + p);
      }
      lines.push("quota note: 20000 free pages/day per model");
      return lines.join("\n");
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_absorb",
    description: "Auto-absorb dsh-lib-analyzer reports into the research wiki + related.db: scans batch/out and .dsh-lib-analyzer/pages for .md reports and writes each as a wiki page (kind=experiment by default) and indexes it. The zero-friction loop: libreport sinks a knowledge page -> run this -> it becomes wiki literature/experiment pages searchable via rlab_related.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" },
      dir: { type: "string", description: "directory to scan (default: auto-detect batch/out + .dsh-lib-analyzer/pages)" },
      kind: { type: "string", description: "wiki kind: experiment (default) | literature | decision" },
      max: { type: "number", description: "max reports to absorb (default 50)" }
    },
    output: textOut,
    timeoutMs: 6e4,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      if (!project) throw new Error("project required");
      const kind = String(args?.kind ?? "experiment").trim();
      if (!["experiment", "literature", "decision"].includes(kind)) throw new Error("kind must be experiment|literature|decision");
      const max = Number(args?.max) || 50;
      const dirs = String(args?.dir ?? "").trim() ? [String(args?.dir).trim()] : [path7.join(project, "batch", "out"), path7.join(project, ".dsh-lib-analyzer", "pages")];
      let written = 0, indexed = 0, skipped = 0;
      const files = [];
      for (const d of dirs) {
        if (!fs7.existsSync(d)) continue;
        const walk = (p) => {
          for (const f of fs7.readdirSync(p, { withFileTypes: true })) {
            if (f.name.startsWith(".")) continue;
            const full = path7.join(p, f.name);
            if (f.isDirectory()) walk(full);
            else if (f.name.endsWith(".md") && files.length < max) files.push(full);
          }
        };
        walk(d);
      }
      for (const f of files) {
        try {
          const text = fs7.readFileSync(f, "utf8").slice(0, 2e4);
          const rel = path7.relative(project, f).replace(/\\/g, "/");
          const slug = path7.basename(f, ".md").replace(/[^\w\u4e00-\u9fff-]+/g, "-").slice(0, 60) || "report";
          writeWikiPage(project, { kind, id: slug, title: slug + " (absorbed)", updated: today(), content: text.slice(0, 5e3) + "\n\n---\nSource: " + rel, tags: ["absorb", path7.basename(path7.dirname(f))] });
          addDoc(project, rel, text, "absorb");
          written++;
          indexed++;
        } catch {
          skipped++;
        }
      }
      return "Absorbed " + written + " reports (" + files.length + " found, " + skipped + " skipped) from: " + (dirs.filter((d) => fs7.existsSync(d)).join(", ") || "(no dirs)") + "\nwiki pages: " + written + " | related.db docs: " + indexed;
    }
  }));
  ctx.tools.register(defineTool({
    name: "rlab_status",
    description: "One-screen state of a research project: wiki page counts per kind, benchmark ledger summary (models \xD7 tasks with latest scores), and open TODOs. Read this first when continuing work on a project.",
    parameters: {
      project: { type: "string", required: true, description: "absolute path to the research project root" }
    },
    output: textOut,
    timeoutMs: 1e4,
    async execute(args) {
      const project = String(args?.project ?? "").trim();
      if (!project) throw new Error("project required");
      const dir = rlabDir(project);
      if (!fs7.existsSync(dir)) return "No .rlab/ directory at " + project + " yet. Start with rlab_wiki or rlab_bench.";
      const pages = listWiki(project);
      const count = (k) => pages.filter((p) => p.kind === k).length;
      const benchRows = readBench(project);
      const todoPages = pages.filter((p) => p.kind === "todo");
      const lines = [
        "# Research status \u2014 " + project,
        "",
        "## Wiki  (" + pages.length + " pages)",
        "- experiments: " + count("experiment"),
        "- literature: " + count("literature"),
        "- decisions: " + count("decision"),
        "- todo: " + count("todo"),
        "",
        "## Bench (" + benchRows.length + " rows)",
        ""
      ];
      lines.push(benchReport(project));
      lines.push("");
      if (todoPages.length) {
        lines.push("## Open TODOs");
        for (const t of todoPages) lines.push("- " + t.title + "  (" + t.id + ")");
        lines.push("");
      }
      lines.push("_State dir: " + dir + "_");
      return lines.join("\n");
    }
  }));
}
export {
  apply,
  inject,
  name
};
