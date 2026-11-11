// One real writer subprocess, used by test-concurrent-writers.mjs.
//
// The parent starts TWO of these against the SAME file with the same wall-clock start instant.
// They never talk to each other, which is the point: the assertion is about what the bytes on disk
// look like after two independent processes each wrote their share.
//
// usage: node test-concurrent-child.mjs <append|cite|wiki> <project> <owner> <count> <startAtMs> <arg>
//   append  arg = id base;        each iteration appends one new claim
//   cite    arg = claim id;       each iteration bumps that claim's citation count
//   wiki    arg = ignored;        each iteration writes the same wiki page id 'shared'
const [mode, project, owner, countArg, startAtArg, argArg] = process.argv.slice(2);
const count = Number(countArg);
const arg = Number(argArg);

// Hard start barrier. Node startup jitter is hundreds of ms while the write loop is only tens of
// ms, so without this the two processes could easily run one after the other and the test would
// pass while proving nothing. Atomics.wait() sleeps without spinning.
const waitMs = Number(startAtArg) - Date.now();
if (waitMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);

const rel = await import(new URL('./test-all.mjs', import.meta.url).href);

function need(name) {
  if (typeof rel[name] !== 'function') {
    console.error('[child ' + owner + '] ' + name + '() is not exported by test-all.mjs — the append-only writer API this test specifies does not exist.');
    process.exit(2);
  }
  return rel[name];
}

try {
  if (mode === 'append') {
    const appendClaim = need('appendClaim');
    for (let i = 0; i < count; i++) {
      appendClaim(project, {
        id: arg + i + 1,
        docId: 0,
        type: 'contribution',
        subject: owner + '-' + i,
        context: 'writer ' + owner + ' record ' + i + ' — two processes append to one file at the same time',
      }, owner);
    }
  } else if (mode === 'cite') {
    const citeClaim = need('citeClaim');
    for (let i = 0; i < count; i++) {
      const c = citeClaim(project, arg, 100, owner);
      if (!c) throw new Error('citeClaim returned null for claim #' + arg);
    }
  } else if (mode === 'wiki') {
    const writeWikiPage = need('writeWikiPage');
    for (let i = 0; i < count; i++) {
      writeWikiPage(project, {
        kind: 'experiment',
        id: 'shared',
        title: 'Shared page',
        updated: '2026-11-12',
        content: 'body from ' + owner + ' #' + i,
        owner,
      });
    }
  } else {
    throw new Error('unknown mode ' + mode);
  }
  process.exit(0);
} catch (e) {
  console.error('[child ' + owner + '] ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
}
