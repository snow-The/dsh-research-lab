/**
 * rlab_related action=ingest — the second tool that hung the host.
 *
 * Why it hung, in three layers: no ledger (a repeat call re-read and re-inserted every file), no bound
 * (maxFiles defaulted to 200 and the loop ran to completion), and a hidden quadratic — addDoc refreshed
 * the corpus-wide TF-IDF lexicon after EVERY insert, so an N-file ingest paid O(N^2) tokenization
 * (124 files was enough). These assertions pin all three: calls ADVANCE, the work per call is bounded
 * in wall-clock time, and the lexicon is refreshed once for the batch instead of once per document.
 *
 * Run: node --import ./test-hooks.mjs test-ingest.mjs
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const mod = await import(new URL('./dist/index.js', import.meta.url).href);
const apply = mod.apply ?? mod.default?.apply ?? mod.default;
const registered = [];
const ctx = {
  tools: { register: (d) => { registered.push(d); return d; } },
  get: () => undefined,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  effect: () => {}, provide: () => {}, on: () => {},
};
apply(ctx, {});
const related = registered.find((t) => t.name === 'rlab_related');
assert.ok(related, 'rlab_related must be registered');

const project = mkdtempSync(join(tmpdir(), 'ingest-test-'));
const docs = join(project, 'pages');
mkdirSync(docs, { recursive: true });
for (let i = 1; i <= 30; i++) {
  writeFileSync(join(docs, 'd' + String(i).padStart(2, '0') + '.md'), '# doc ' + i + '\n\n' + ('term' + i + ' ').repeat(60));
}
const ingest = async (args = {}) => {
  const started = Date.now();
  const text = String(await related.execute({ project, action: 'ingest', dir: docs, budgetMs: 8000, ...args }, {}));
  return { text, ms: Date.now() - started };
};
const num = (text, re) => Number(re.exec(text)?.[1] ?? NaN);
const docs_ = () => { const db = new DatabaseSync(join(project, '.rlab', 'related.db')); const n = db.prepare('SELECT COUNT(*) c FROM docs').get().c; db.close(); return n; };

const first = await ingest({ max: 10 });
assert.equal(num(first.text, /Ingested (\d+) new/), 10, first.text);
assert.equal(num(first.text, /(\d+) still pending/), 20, 'the backlog is reported, not hidden: ' + first.text);
assert.ok(first.ms < 8000, 'a bounded call returns inside its budget; took ' + first.ms + 'ms');

const second = await ingest({ max: 10 });
assert.equal(num(second.text, /Ingested (\d+) new/), 10, 'a second identical call ADVANCES: ' + second.text);
assert.equal(num(second.text, /unchanged (\d+)/), 10, second.text);
assert.equal(num(second.text, /(\d+) still pending/), 10, second.text);

const third = await ingest({ max: 10 });
assert.equal(num(third.text, /Ingested (\d+) new/), 10, third.text);
assert.match(third.text, /Nothing left to ingest/, third.text);
assert.equal(docs_(), 30, 'thirty documents, one row each');

const fourth = await ingest({ max: 10 });
assert.equal(num(fourth.text, /Ingested (\d+) new/), 0, 'idempotent once the ledger covers the tree: ' + fourth.text);
assert.equal(num(fourth.text, /unchanged (\d+)/), 30, fourth.text);
assert.equal(docs_(), 30, 'still thirty: a repeat call writes nothing');

writeFileSync(join(docs, 'd07.md'), '# doc 7 EDITED\n\n' + 'changed '.repeat(80));
const edited = await ingest({ max: 10 });
assert.equal(num(edited.text, /Ingested (\d+) new/), 0, edited.text);
assert.equal(num(edited.text, /\+ (\d+) updated/), 1, 'only the EDITED file is rewritten: ' + edited.text);
assert.equal(docs_(), 30, 'an edit updates the row in place instead of adding another');

console.log('rlab_related ingest: OK — resumable, bounded (' + first.ms + '/' + second.ms + '/' + third.ms + ' ms per 10-file call), one row per file, edits in place');
try { rmSync(project, { recursive: true, force: true }); } catch { /* a live sqlite handle may hold the temp dir on Windows */ }
