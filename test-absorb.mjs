/**
 * rlab_absorb semantics — the regression this file exists for.
 *
 * It used to collect the FIRST max files of a directory on every call: no cursor, no ledger, no
 * dedupe (so a second call re-did the same work and reported "0 skipped" every time, and the docs
 * table gained a duplicate row per call), and it ran the whole loop synchronously — a max=200 call
 * blocked the host event loop until the host was restarted. These assertions are the contract now:
 * repeated calls ADVANCE, unchanged files are skipped, a changed file is re-indexed in place.
 *
 * Run: npm run test:absorb
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const mod = await import(new URL('./dist/index.js', import.meta.url).href);
const apply = mod.apply ?? mod.default?.apply ?? mod.default;
assert.equal(typeof apply, 'function', 'the bundle must export apply');

const registered = [];
const ctx = {
  tools: { register: (d) => { registered.push(d); return d; } },
  get: () => undefined,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  effect: () => {}, provide: () => {}, on: () => {},
};
apply(ctx, {});
const absorb = registered.find((t) => t.name === 'rlab_absorb');
assert.ok(absorb, 'rlab_absorb must be registered');

const project = mkdtempSync(join(tmpdir(), 'absorb-test-'));
mkdirSync(join(project, 'batch', 'out'), { recursive: true });
for (let i = 1; i <= 5; i++) {
  writeFileSync(join(project, 'batch', 'out', 'r0' + i + '.md'), '# report ' + i + '\n\n' + 'x'.repeat(1500) + '\n');
}
const call = async (args = {}) => String(await absorb.execute({ project, ...args }, {}));
const num = (text, re) => Number(re.exec(text)?.[1] ?? NaN);
const docs = () => { const db = new DatabaseSync(join(project, '.rlab', 'related.db')); const n = db.prepare('SELECT COUNT(*) c FROM docs').get().c; db.close(); return n; };

const first = await call({ max: 2 });
assert.equal(num(first, /Absorbed (\d+) report/), 2, first);
assert.equal(num(first, /(\d+) still pending/), 3, 'the rest is REPORTED as pending: ' + first);

const second = await call({ max: 2 });
assert.equal(num(second, /Absorbed (\d+) report/), 2, 'a second identical call must ADVANCE, not repeat: ' + second);
assert.equal(num(second, /(\d+) unchanged since the last run/), 2, second);
assert.equal(num(second, /(\d+) still pending/), 1, second);

const third = await call({ max: 2 });
assert.equal(num(third, /Absorbed (\d+) report/), 1, third);
assert.match(third, /Nothing left to absorb/);

const fourth = await call({ max: 2 });
assert.equal(num(fourth, /Absorbed (\d+) report/), 0, 'idempotent once the ledger covers the directory: ' + fourth);
assert.equal(num(fourth, /(\d+) unchanged since the last run/), 5, fourth);
assert.equal(docs(), 5, 'five documents, not one row per call');

writeFileSync(join(project, 'batch', 'out', 'r03.md'), '# report 3 EDITED\n\n' + 'y'.repeat(1600) + '\n');
const edited = await call({ max: 5 });
assert.equal(num(edited, /Absorbed (\d+) report/), 1, 'only the EDITED file comes back: ' + edited);
assert.match(edited, /1 re-indexed in place/, edited);
assert.equal(docs(), 5, 'an edit updates the existing document instead of adding a second one');

console.log('rlab_absorb semantics: OK (resumable, skips unchanged, re-indexes changed files in place, no duplicate rows)');
try { rmSync(project, { recursive: true, force: true }); } catch { /* a live sqlite handle may hold the temp dir on Windows */ }
