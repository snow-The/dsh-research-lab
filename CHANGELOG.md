# Changelog

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
