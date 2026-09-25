# Changelog

## 0.2.3

- fix(rlab_absorb): the batch path still refreshed the corpus-wide TF-IDF lexicon **per document** —
  the same O(N^2) that v0.2.2 removed from ingest, missed on the absorb side. Found by running the fix
  on the REAL backlog that hung the host (`~/01/r32/batch/out`, 125 reports over a 427-document corpus):
  `max=20` took **9,723 ms and absorbed 5 files** (~1,900 ms/file), against ~46 ms/file on the ingest
  path. `addDoc`/`updateDoc` now get `refreshLexicon:false` and the batch refreshes ONCE:
  **50 files in 2,833 ms (~57 ms/file, 33x)**, the whole 125-file backlog absorbed in three bounded
  calls (8.8 s total, each returning inside its budget), and a re-run is 7 ms with 125 unchanged.
- test: the absorb suite gained a wall-clock ceiling (72 files, < 20 s) — at the old per-file rate that
  workload needed ~2.3 minutes, so the quadratic cannot come back unnoticed.
## 0.2.2

- fix(rlab_related ingest): the second tool that could hang the host — for three reasons at once.
  - **No ledger**: a repeat call re-read and re-inserted the same files (124 done, run it again -> the
    same 124 again) and the docs table gained a duplicate row each time. Files are now keyed by
    `size:mtime` in the same absorb ledger, so a repeat call is a no-op and a NEW file is picked up.
  - **No bound**: `maxFiles` defaulted to 200 and the loop ran to completion. `ingest` now takes `max`
    (per call, default 200) and `budgetMs` (default 8000), and the TOOL drives it in bounded chunks with
    a yield to the event loop between them — the document layer is synchronous by design (node:sqlite
    `DatabaseSync` + sync fs), so the tool is what has to hand the loop back.
  - **A hidden quadratic**: `addDoc` refreshed the corpus-wide TF-IDF lexicon after EVERY insert, so an
    N-file ingest paid O(N^2) tokenization — this is what turned 124 files into a hang, not the file
    count. `addDoc`/`updateDoc` take `refreshLexicon:false` and the batch refreshes ONCE at the end.
  - An EDITED document is re-indexed **in place** (FTS row re-synced) instead of being added again, and
    the result reports new / updated / unchanged / failed / still pending with a "call again" hint.
  - `ingestDocDir` keeps its synchronous signature (a number or an options object as the third
    argument) because the fuzz suite drives it directly; the returned object gained fields and its
    `skipped` now means "a file failed", not "a file was not .md".
- test: `npm run test:ingest` pins resumability, the wall-clock bound (201/250/311 ms per 10-file
  call) and one row per file; `npm run test:absorb` covers the same contract for absorb. Existing suite
  28/28, fuzz 0 problems.
## 0.2.1

- fix(rlab_absorb): the tool had **no cursor and no ledger**. It collected the first `max` files of a
  directory on every call, so a second identical call re-did the same work and reported "0 skipped"
  every time (that counter only ever meant "an exception was caught" — never "already done"), while the
  docs table gained a duplicate row per call; and the loop was fully synchronous, so a `max: 200` call
  blocked the host event loop until the host had to be restarted. It is resumable and bounded now:
  - an `absorbed` ledger in related.db keys each file by `size:mtime`, so an unchanged file is decided
    **without reading it** and repeated calls ADVANCE through the directory;
  - per call: at most `max` files, inside a `budgetMs` wall-clock budget (default 8000), yielding to the
    event loop between files — a large backlog can no longer block the host;
  - newest first (mtime desc), so a report written a minute ago never queues behind a year-old backlog;
  - an EDITED file is re-absorbed and its indexed document is **updated in place** (`updateDoc`, with the
    FTS row re-synced) instead of being added as a second document;
  - the result reports found / unchanged / failed / re-indexed / still pending and says when to call
    again — no more silent no-op.
- test: `npm run test:absorb` pins the contract (a second call advances, unchanged files are skipped, an
  edit re-indexes in place, one row per file); the existing suite stays at 28/28.
## 0.2.0

- feat(rlab_scoop): a novelty audit for a claim, in the shape of the `scoop_check` skill from
  microsoft/ResearchStudio-Idea ([arXiv 2607.04439](https://arxiv.org/abs/2607.04439), MIT):
  **four axes** (problem framing / core mechanism / key insight / application domain), **three
  complementary query families** (original-problem / broad-domain / method-signature), a **0-4
  axis-overlap score** per candidate, and the **7-step** flow ending in a delta statement.
  The page lands in `.rlab/wiki/experiment/scoop-<id>.md` and the wiki index is rebuilt.
  - The part a prompt cannot give: **the gaps stay visible**. Every step the caller did not supply is
    printed as `未做` / `未填`, and the summary carries an explicit completeness line plus a warning.
    A novelty audit that silently skips the deep dive reads exactly like one that looked and found
    nothing — that is the failure this structure exists to prevent.
  - Retrieval is deliberately NOT done here: run `search_open` / `search_arxiv` (dsh-search) and pass
    the hits in. One owner per capability — the lab records and audits, the search plugin retrieves.
  - Method attribution is written into every page (§6), as the source project asks.
- test: nine assertions in `test-suite.mjs`, most of them about the honest-failure property (an empty
  audit must print the gap warning, an unfilled axis must read `未填`, every step must still be listed,
  and a pure-CJK claim must still get a deterministic id). 28/28. Also boot-checked end to end: the
  tool registers, writes the page, rebuilds the index.
