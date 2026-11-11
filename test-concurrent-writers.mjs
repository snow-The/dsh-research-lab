// Multi-writer concurrency spec for the research lab's two ledgers.
//
// Why this file exists: both ledgers were written by REWRITING the whole file (claims: citeClaim;
// wiki: writeWikiPage), so a second writer silently overwrote the first. A single-process test can
// never see that. These tests therefore start REAL child processes — two at a time, released by a
// barrier so they hit the same file together — and then inspect the bytes on disk.
//
// Run: node test-concurrent-writers.mjs        (run `npm run build:tests` first, as npm test does)
// RED before the append-only change: appendClaim/readWikiHistory do not exist and citations from
// two processes annihilate each other. GREEN after: every write is a line, nothing is overwritten.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, 'test-concurrent-child.mjs');
const rel = await import(new URL('./test-all.mjs', import.meta.url).href);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};
const fp = (raw) => createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
const call = (name, ...args) => {
  if (typeof rel[name] !== 'function') throw new Error(name + '() is not exported by test-all.mjs (append-only writer API missing)');
  return rel[name](...args);
};

function freshProject(tag) {
  const p = path.join(tmpdir(), 'rlab-mw-' + process.pid + '-' + tag + '-' + Math.random().toString(36).slice(2, 7));
  fs.rmSync(p, { recursive: true, force: true });
  fs.mkdirSync(path.join(p, '.rlab'), { recursive: true });
  return p;
}
const claimsFile = (p) => path.join(p, '.rlab', 'claims.jsonl');

// Start both children, let them sleep until the same instant, then let them run.
function spawnWriters(specs, barrierMs = 1200) {
  const startAt = Date.now() + barrierMs;
  return Promise.all(specs.map((s) => new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [CHILD, s.mode, s.project, s.owner, String(s.count), String(startAt), String(s.arg ?? 0)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => resolve({ owner: s.owner, code: -1, out, err: err + String(e) }));
    child.on('close', (code) => resolve({ owner: s.owner, code, out, err }));
  })));
}

function readClaims(file) {
  if (!fs.existsSync(file)) return { lines: [], records: [], bad: 0, tail: 'FILE MISSING' };
  const parts = fs.readFileSync(file, 'utf8').split('\n');
  const tail = parts.pop();               // '' iff the file ends on a line boundary
  const records = [];
  let bad = 0;
  for (const line of parts) {
    try { records.push(JSON.parse(line)); } catch { bad++; }
  }
  return { lines: parts, records, bad, tail };
}

const transitions = (owners) => owners.split('').reduce((n, ch, i, arr) => n + (i && ch !== arr[i - 1] ? 1 : 0), 0);
const summary = (results) => results.map((r) => r.owner + '=' + r.code + ' ' + r.err.trim().slice(0, 240)).join(' | ');

async function phase(title, fn) {
  console.log('\n== ' + title + ' ==');
  try { await fn(); } catch (e) { fail++; console.log('  ❌ phase did not run — ' + (e && e.message ? e.message : String(e))); }
}

// ---------------------------------------------------------------------------------------------
// A. the required burst: 2 processes × 100 appends into ONE claims file, 5 consecutive runs.
// ---------------------------------------------------------------------------------------------
await phase('A. two processes × 100 appends into ONE claims.jsonl (5 consecutive runs)', async () => {
  const BURST_RUNS = 5, PER_WRITER = 100;
  for (let run = 1; run <= BURST_RUNS; run++) {
    const project = freshProject('burst' + run);
    const file = claimsFile(project);
    const results = await spawnWriters([
      { mode: 'append', project, owner: 'writer-a', count: PER_WRITER, arg: 0 },
      { mode: 'append', project, owner: 'writer-b', count: PER_WRITER, arg: 1000 },
    ]);
    ok('run ' + run + ': both child processes exited 0', results.every((r) => r.code === 0), summary(results));

    const got = readClaims(file);
    ok('run ' + run + ': all 200 records are on disk (nothing overwritten)', got.records.length === 200 && got.lines.length === 200,
      got.lines.length + ' lines / ' + got.records.length + ' parsed');
    ok('run ' + run + ': every line is valid JSON (no half lines)', got.bad === 0, got.bad + ' unparseable');
    ok('run ' + run + ': the file ends on a line boundary (no torn tail)', got.tail === '', JSON.stringify(String(got.tail).slice(0, 80)));
    const keys = got.records.map((r) => r.owner + '#' + r.id);
    ok('run ' + run + ': 200 distinct records — not 200 lines of duplicates', new Set(keys).size === 200, String(new Set(keys).size));
    const byOwner = { 'writer-a': 0, 'writer-b': 0 };
    for (const r of got.records) if (r.owner in byOwner) byOwner[r.owner]++;
    ok('run ' + run + ': both writers are present, 100 records each', byOwner['writer-a'] === 100 && byOwner['writer-b'] === 100, JSON.stringify(byOwner));
    ok('run ' + run + ': every record carries owner + ISO recordedAt',
      got.records.every((r) => typeof r.owner === 'string' && r.owner && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(r.recordedAt))));
    ok('run ' + run + ': every line stays inside the 4 KB atomic-append bound',
      got.lines.every((l) => Buffer.byteLength(l, 'utf8') + 1 <= 4096),
      'max ' + Math.max(0, ...got.lines.map((l) => Buffer.byteLength(l, 'utf8'))) + ' bytes');
    const owners = got.records.map((r) => (r.owner === 'writer-a' ? 'a' : 'b')).join('');
    const t = transitions(owners);
    ok('run ' + run + ': the two writers really interleaved (the barrier worked)', t >= 2, t + ' transitions: ' + owners.slice(0, 40));
    fs.rmSync(project, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// B. the actual bug in the old code: two citers each read-modify-rewrite the whole file, so the
//    last writer wins and the other's updates vanish. Append-only must keep every version.
// ---------------------------------------------------------------------------------------------
await phase('B. concurrent citations must not overwrite each other (one record per citation)', async () => {
  const CITE_RUNS = 3, CITE_EACH = 25;
  for (let run = 1; run <= CITE_RUNS; run++) {
    const project = freshProject('cite' + run);
    const file = claimsFile(project);
    // seed one LEGACY-shaped record (no owner, no recordedAt, no supersedes) — the old format must
    // keep working, and citeClaim must upgrade it by appending, not by rewriting the file.
    fs.writeFileSync(file, JSON.stringify({ id: 7, docId: 0, type: 'result', subject: 'seed', value: '0.5', task: 'STS12', context: 'seed claim', cited: 0, confidence: 0.5, date: '2026-01-01' }) + '\n', 'utf8');

    const results = await spawnWriters([
      { mode: 'cite', project, owner: 'writer-a', count: CITE_EACH, arg: 7 },
      { mode: 'cite', project, owner: 'writer-b', count: CITE_EACH, arg: 7 },
    ]);
    ok('run ' + run + ': both citing processes exited 0', results.every((r) => r.code === 0), summary(results));

    const got = readClaims(file);
    const mine = got.records.filter((r) => r.id === 7);
    ok('run ' + run + ': 1 seed + 50 citation records survive in the file', mine.length === 51, String(mine.length));
    ok('run ' + run + ': every citation version names the version it replaces', mine.filter((r) => r.supersedes).length === 50,
      String(mine.filter((r) => r.supersedes).length));
    const lineFps = new Set(got.lines.map(fp));
    ok('run ' + run + ': every supersedes is sha256[:16] of a line that exists in this file',
      mine.every((r) => !r.supersedes || lineFps.has(r.supersedes)),
      mine.filter((r) => r.supersedes && !lineFps.has(r.supersedes)).map((r) => r.supersedes).join(','));
    const visible = call('loadClaims', project).filter((r) => r.id === 7);
    ok('run ' + run + ': default read hides the superseded versions but keeps one', visible.length >= 1 && visible.length < 51,
      String(visible.length));
    const full = call('loadClaims', project, { includeSuperseded: true }).filter((r) => r.id === 7);
    ok('run ' + run + ': includeSuperseded returns the whole chain', full.length === 51, String(full.length));
    ok('run ' + run + ': no line exceeds the 4 KB append bound', got.lines.every((l) => Buffer.byteLength(l, 'utf8') + 1 <= 4096));
    fs.rmSync(project, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// C. old files must keep working: no owner, no recordedAt, no supersedes.
// ---------------------------------------------------------------------------------------------
await phase('C. a claims file written by the old single-writer code is still readable', async () => {
  const project = freshProject('legacy');
  const file = claimsFile(project);
  const legacy = [
    { id: 1, docId: 3, type: 'contribution', subject: 'legacy one', context: 'written before owner existed', cited: 2, confidence: 0.5196, date: '2026-01-01' },
    { id: 2, docId: 3, type: 'result', subject: 'result', value: '0.42', task: 'STS12', context: 'old shape', cited: 0, confidence: 0.5, date: '2026-01-01' },
  ];
  fs.writeFileSync(file, legacy.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const loaded = call('loadClaims', project);
  ok('both legacy records are readable', loaded.length === 2 && loaded[0].id === 1 && loaded[1].value === '0.42', JSON.stringify(loaded.map((r) => r.id)));
  ok('no owner is invented for a legacy record', loaded.every((r) => r.owner === undefined));
  const report = call('claimsReport', project);
  ok('claimsReport still renders legacy rows with their numbers', /legacy one/.test(report) && /0\.42/.test(report), report.split('\n').slice(0, 3).join(' / '));

  const cited = call('citeClaim', project, 1);
  ok('citing a legacy row appends a version instead of rewriting the file', !!cited && cited.cited === 3 && typeof cited.supersedes === 'string', cited ? 'cited=' + cited.cited + ' supersedes=' + cited.supersedes : 'null');
  ok('the appended version carries owner=unknown when the caller gave none', !!cited && cited.owner === 'unknown', cited ? String(cited.owner) : 'null');
  ok('the supersedes value is the fingerprint of the legacy line it replaces', !!cited && cited.supersedes === fp(JSON.stringify(legacy[0])), cited ? String(cited.supersedes) : 'null');

  const after = call('loadClaims', project);
  ok('the superseded legacy row is hidden by default', after.filter((r) => r.id === 1).length === 1 && after.filter((r) => r.id === 1)[0].cited === 3,
    JSON.stringify(after.filter((r) => r.id === 1).map((r) => r.cited)));
  const all2 = call('loadClaims', project, { includeSuperseded: true });
  ok('includeSuperseded returns both versions', all2.filter((r) => r.id === 1).length === 2, String(all2.filter((r) => r.id === 1).length));

  fs.appendFileSync(file, '{"id":9,"docId":0,"type":"contribu', 'utf8');   // a torn tail line
  const tolerant = call('loadClaims', project, { includeSuperseded: true });
  ok('a torn tail line is skipped, not fatal', tolerant.length === all2.length, tolerant.length + ' vs ' + all2.length);
  fs.rmSync(project, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// D. the atomicity boundary: a record over 4 KB is refused, never truncated.
// ---------------------------------------------------------------------------------------------
await phase('D. a record over the 4 KB atomic bound is refused, never truncated', async () => {
  const project = freshProject('oversize');
  const file = claimsFile(project);
  let err = null, ret = null;
  try {
    ret = call('appendClaim', project, { id: 1, context: 'x'.repeat(5000) }, 'writer-a');
  } catch (e) { err = e; }
  ok('a 5 KB claim record throws instead of being written', !!err, err ? '' : 'no error, wrote ' + JSON.stringify(ret).slice(0, 80));
  ok('the error is coded APPEND_RECORD_TOO_LARGE', !!err && err.code === 'APPEND_RECORD_TOO_LARGE', err ? String(err.code) : 'no error');
  ok('the error names the 4096-byte limit and says "split"', !!err && /4096/.test(String(err.message)) && /split/i.test(String(err.message)), err ? String(err.message) : '');
  ok('nothing was written (no silent truncation on disk)', !fs.existsSync(file) || fs.readFileSync(file, 'utf8') === '',
    fs.existsSync(file) ? JSON.stringify(fs.readFileSync(file, 'utf8').slice(0, 80)) : 'file absent');
  fs.rmSync(project, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// E. wiki pages: <page>.md is the latest projection, <page>.history.jsonl is the append-only ledger.
// ---------------------------------------------------------------------------------------------
await phase('E. wiki page: .md shows the latest version, .history.jsonl keeps every version', async () => {
  const project = freshProject('wiki');
  const page = call('writeWikiPage', project, { kind: 'experiment', id: 'shared', title: 'Shared page', updated: '2026-11-12', content: 'version one', owner: 'agent-a' });
  const md1 = fs.readFileSync(page, 'utf8');
  ok('the page file still exists with the unchanged frontmatter contract',
    /^---\nid: shared\nkind: experiment\ntitle: Shared page\nupdated: 2026-11-12\n/.test(md1), JSON.stringify(md1.slice(0, 120)));
  ok('the first version is the visible page', md1.includes('version one'));
  const histFile = page.replace(/\.md$/, '') + '.history.jsonl';
  ok('a history ledger appears next to the page', fs.existsSync(histFile), histFile);

  const md2raw = call('writeWikiPage', project, { kind: 'experiment', id: 'shared', title: 'Shared page', updated: '2026-11-12', content: 'version two', owner: 'agent-b' });
  const md2 = fs.readFileSync(md2raw, 'utf8');
  ok('the .md file shows the latest version', md2.includes('version two') && !md2.includes('version one'));

  const hist = call('readWikiHistory', project, 'experiment', 'shared');
  ok('both versions are in the history ledger', hist.length === 2 && hist[0].body.includes('version one') && hist[1].body.includes('version two'),
    JSON.stringify(hist.map((h) => h.body.split('\n').filter(Boolean).slice(-1)[0])));
  ok('each entry carries its writer and an ISO timestamp', hist.every((h) => typeof h.owner === 'string' && h.owner && /^\d{4}-\d{2}-\d{2}T/.test(h.at)),
    JSON.stringify(hist.map((h) => [h.owner, h.at])));
  ok('the newer version names the version it replaces', hist[1].supersedes === hist[0].fingerprint,
    JSON.stringify([hist[1].supersedes, hist[0].fingerprint]));
  ok('the superseded version is flagged, not deleted', hist[0].superseded === true && hist[1].superseded === false,
    JSON.stringify(hist.map((h) => h.superseded)));

  const histLines = fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean);
  ok('every history line is valid JSON within the 4 KB bound',
    histLines.every((l) => { try { JSON.parse(l); } catch { return false; } return Buffer.byteLength(l, 'utf8') + 1 <= 4096; }),
    'max ' + Math.max(...histLines.map((l) => Buffer.byteLength(l, 'utf8'))) + ' bytes');

  const big = 'y'.repeat(9000);
  const bigPage = call('writeWikiPage', project, { kind: 'experiment', id: 'big', title: 'Big page', updated: '2026-11-12', content: big, owner: 'agent-c' });
  const bigLines = fs.readFileSync(bigPage.replace(/\.md$/, '') + '.history.jsonl', 'utf8').split('\n').filter(Boolean);
  ok('a 9 KB body is split so that no line exceeds 4 KB', bigLines.length >= 2 && bigLines.every((l) => Buffer.byteLength(l, 'utf8') + 1 <= 4096),
    bigLines.length + ' lines, max ' + Math.max(...bigLines.map((l) => Buffer.byteLength(l, 'utf8'))) + ' bytes');
  const bigHist = call('readWikiHistory', project, 'experiment', 'big');
  ok('the split body reassembles byte-for-byte', bigHist.length === 1 && bigHist[0].body.includes(big), String(bigHist.length) + ' entries');
  fs.rmSync(project, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// F. two processes writing the SAME page: every version survives, the projection is always whole.
// ---------------------------------------------------------------------------------------------
await phase('F. two processes writing the same wiki page: every version survives', async () => {
  const project = freshProject('wiki-conc');
  const results = await spawnWriters([
    { mode: 'wiki', project, owner: 'agent-a', count: 20 },
    { mode: 'wiki', project, owner: 'agent-b', count: 20 },
  ]);
  ok('both wiki writers exited 0', results.every((r) => r.code === 0), summary(results));

  const page = path.join(project, '.rlab', 'wiki', 'experiment', 'shared.md');
  const md = fs.readFileSync(page, 'utf8');
  const fm = call('parseFrontmatter', md);
  ok('the visible projection is a whole page (frontmatter parses, body is one version)', fm.id === 'shared' && fm.kind === 'experiment' && /body from agent-[ab] #\d+\n$/.test(md),
    JSON.stringify(fm));
  ok('the projection is one of the versions in the ledger', md.includes('body from agent-'));

  const hist = call('readWikiHistory', project, 'experiment', 'shared');
  ok('all 40 versions survive in the history ledger', hist.length === 40, String(hist.length));
  const bodies = hist.map((h) => (h.body.match(/body from agent-[ab] #\d+/) || [])[0]);
  ok('40 distinct bodies — both writers are fully represented', new Set(bodies).size === 40 && bodies.filter((b) => b && b.includes('agent-a')).length === 20,
    new Set(bodies).size + ' distinct, ' + bodies.filter((b) => b && b.includes('agent-a')).length + ' from agent-a');
  const histLines = fs.readFileSync(page.replace(/\.md$/, '') + '.history.jsonl', 'utf8').split('\n').filter(Boolean);
  ok('every history line is valid JSON within the 4 KB bound',
    histLines.every((l) => { try { JSON.parse(l); } catch { return false; } return Buffer.byteLength(l, 'utf8') + 1 <= 4096; }),
    histLines.length + ' lines, max ' + Math.max(...histLines.map((l) => Buffer.byteLength(l, 'utf8'))) + ' bytes');
  fs.rmSync(project, { recursive: true, force: true });
});

console.log('\n===== RESULT: ' + pass + ' passed / ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);
