/**
 * Fuzz the research lab's document layer with hostile trees and payloads.
 *
 * ingest/addDoc take whatever a user points at (directories, file contents, queries), so
 * both the SHAPE of the tree and the CONTENT are untrusted: junction cycles, deep nesting,
 * binary blobs, 8 MB files, surrogate pairs, NUL bytes, empty queries, zero rounds.
 *
 * Invariants: returns a value, never throws, terminates, bounded wall time.
 *   node test-fuzz-ingest.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as rel from './test-all.mjs';

const problems = [];
const root = mkdtempSync(join(tmpdir(), 'fuzz-lab-'));
const proj = join(root, 'proj');
mkdirSync(proj, { recursive: true });

const case_ = async (name, fn) => {
  const started = Date.now();
  try { await fn(); } catch (err) {
    problems.push({ name, why: 'THREW: ' + (err && err.message ? err.message : String(err)) });
  }
  const ms = Date.now() - started;
  if (ms > 20000) problems.push({ name, why: 'SLOW: ' + ms + 'ms' });
};

await case_('addDoc-normal', () => rel.addDoc(proj, 'Distillation notes', 'compact student model 4b', 'test:normal'));
await case_('addDoc-nasty-payloads', () => {
  rel.addDoc(proj, '\u0000\uD800 title'.repeat(20), 'x'.repeat(512 * 1024), 'test:nasty');
  rel.addDoc(proj, 'emoji \uD83D\uDE00', '\u202Ereversed\u202C text', 'test:emoji');
  rel.addDoc(proj, '', '', '');
});
await case_('addDoc-undefined-fields', () => { rel.addDoc(proj, undefined, undefined, undefined); });
await case_('addDoc-null', () => { rel.addDoc(proj, null, null, null); });

// documents on disk, then a directory ingest
const docs = join(root, 'docs'); mkdirSync(docs, { recursive: true });
writeFileSync(join(docs, 'a.md'), '# A\n\nabout distillation');
writeFileSync(join(docs, 'empty.md'), '');
writeFileSync(join(docs, 'binary.bin'), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 11) % 256)));
writeFileSync(join(docs, 'big.md'), 'y'.repeat(4 * 1024 * 1024));
await case_('ingestDocDir-normal', () => rel.ingestDocDir(proj, docs));
await case_('ingestDocDir-missing', () => rel.ingestDocDir(proj, join(root, 'nope')));
await case_('ingestDocDir-file-as-root', () => rel.ingestDocDir(proj, join(docs, 'a.md')));
await case_('ingestDocDir-empty-string', () => rel.ingestDocDir(proj, ''));

// junction cycle
const cyc = join(root, 'cycle'); mkdirSync(join(cyc, 'inner'), { recursive: true });
try { symlinkSync(cyc, join(cyc, 'inner', 'loop'), 'junction'); } catch { /* privileges */ }
writeFileSync(join(cyc, 'doc.md'), 'cycle doc');
await case_('ingestDocDir-junction-cycle', () => rel.ingestDocDir(proj, cyc));

// deep nesting
let deep = join(root, 'deep'); mkdirSync(deep, { recursive: true });
for (let i = 0; i < 150; i++) { deep = join(deep, 'd' + i); try { mkdirSync(deep); } catch { break; } }
writeFileSync(join(deep, 'leaf.md'), 'deep leaf');
await case_('ingestDocDir-deep-150', () => rel.ingestDocDir(proj, join(root, 'deep')));

// hostile queries
await case_('search-weird-queries', () => {
  for (const q of ['', ' ', '\u0000', '\uD800'.repeat(50), 'a'.repeat(100000), '" OR 1=1 --', '*', '%', '_']) rel.search(proj, q, 5);
});
await case_('hybridSearch-weird', () => {
  for (const q of ['', 'distillation', '\u0000\uD800', '"quoted"', 'a*']) rel.hybridSearch(proj, q, 3);
});
await case_('expandSearch-edge-args', () => {
  rel.expandSearch(proj, 'compact student', 0, 5);
  rel.expandSearch(proj, 'compact student', -1, 0);
  rel.expandSearch(proj, '', 2, 5);
});
await case_('topKeywords-edge', () => { rel.topKeywords(proj, 0); rel.topKeywords(proj, -3); rel.topKeywords(proj, 1e6); });

try { rmSync(root, { recursive: true, force: true }); } catch { /* junctions can resist */ }
console.log(JSON.stringify({ problems: problems.length, detail: problems }, null, 1));
process.exit(problems.length ? 1 : 0);
