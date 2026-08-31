# dsh-research-lab

Research-lab toolkit for [DeepSeek Harness](https://github.com/deepseek-ai): a wiki-centric,
eval-rigor-driven research workflow distilled from **AutoSci** (wiki as the center of a research
project), **ASI-Bench** (evaluation rigor), **daily-arXiv-ai-enhanced** (digest),
**ChatPaper** (paper review), **nature-skills / research-writing-skill** (academic writing),
**Supervisor-Skills** (senior-review instinct), and hard lessons from real distillation
experiments (hypothesis → verdict loops, eval 口径 discipline).

## Tools

| tool | purpose | inspired by |
|---|---|---|
| `rlab_wiki` | write wiki pages (`experiment/literature/decision/todo`) under `<project>/.rlab/wiki/` + rebuild index | AutoSci |
| `rlab_experiment` | hypothesis → prediction → evidence → verdict → conclusion pages | AutoSci + falsifiability discipline |
| `rlab_bench` | per-project eval ledger (`bench.jsonl`); flags 口径 (protocol) mismatches, e.g. mixing test/dev splits | ASI-Bench |
| `rlab_paper_review` | arXiv id → adversarial 8-point review checklist (also applies to your own papers) | ChatPaper + ASI-Bench |
| `rlab_arxiv_digest` | keyword digest of recent arXiv papers → `<project>/.rlab/digests/<date>.md` | daily-arXiv-ai-enhanced |
| `rlab_writing` | line-anchored academic-expression check (passive/weak verbs/vague quantifiers/filler/term consistency) | nature-skills, research-writing-skill |
| `rlab_related` | self-building keyword retrieval: NLP tokenization + SQLite FTS5, no preset lexicon — terms are TF-IDF-mined from your docs (EN words + ZH n-grams) and expanded iteratively (search → mine → merge → repeat) | hamuleite-style corpus, Rocchio relevance feedback |
| `rlab_status` | one-screen project state: wiki counts, bench report, open TODOs | — |

## On-disk layout

```
<project>/.rlab/
  wiki/
    index.md            # auto-rebuilt
    experiment/<id>.md  # hypothesis → verdict
    literature/<id>.md  # paper notes (link from digests)
    decision/<id>.md    # ADRs: why you chose X
    todo/<id>.md        # open items
  related.db           # FTS5 corpus + auto-built lexicon (rlab_related)
  bench.jsonl           # one eval row per line (JSON)
  digests/<date>.md     # arXiv digests
```

## Eval 口径 discipline (rlab_bench)

Every row must state `metric`, `split`, and for MTEB tasks the `hf_subset`. The report
warns whenever a task's history mixes splits — comparing test-vs-dev scores is the classic
way papers fool themselves (and reviewers).

## Install

```bash
# from ~/.dsh/profiles/web
pnpm add @snow-the/dsh-research-lab@file:../.dsh-starter/plugins/dsh-research-lab
# add "dsh-research-lab" to dsh.profile.bundles, then restart dsh web
```

## Build

```bash
pnpm install && pnpm build   # tsc declarations + esbuild bundle → dist/
```