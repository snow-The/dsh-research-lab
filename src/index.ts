/**
 * dsh-research-lab — research lab toolkit for DSH.
 * Inspirations: AutoSci (wiki-centric research), ASI-Bench (eval rigor),
 * daily-arXiv-ai-enhanced (digest), ChatPaper (paper review),
 * nature-skills / research-writing-skill (academic writing), Supervisor-Skills.
 *  - rlab_wiki: write wiki pages (experiment/literature/decision/todo) + rebuild index
 *  - rlab_bench: append eval rows to a per-project ledger, report with 口径 (protocol) warnings
 *  - rlab_experiment: hypothesis → verdict → evidence loop pages (drives honest science)
 *  - rlab_paper_review: arXiv id → structured adversarial review checklist
 *  - rlab_arxiv_digest: keyword digest of recent arXiv papers → markdown file
 *  - rlab_writing: academic-expression check on a text passage
 *  - rlab_status: one-screen project state (wiki count, bench rows, open todos)
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { arxivByIds, arxivSearch, formatPapers, type Paper } from './arxiv.js';
import {
  appendBench, benchReport, listWiki, readBench, rebuildWikiIndex, rlabDir, writeWikiPage,
  type BenchRow, type WikiKind,
} from './store.js';
import { addDoc, expandSearch, hybridSearch, ingestDocDir, mineKeywords, openDb, search, topKeywords, type RelatedDoc } from './related.js';
import { rewriteReport } from './rewrite.js';
import { addClaims, betaConfidence, citeClaim, claimsReport, extractClaims, loadClaims } from './extract.js';
import { suggestExternal, suggestZh } from './suggest.js';
import { cloneAndStudy } from './ref.js';
import * as os from 'node:os';
import { OCR_MODELS, fetchOcrMarkdown, ocrToken, runOcr, type OcrModel } from './ocr.js';

const textOut = { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] };
const today = () => new Date().toISOString().slice(0, 10);

export const name = 'dsh-research-lab';
export const inject = ['tools'];

import { validateWiki } from './validate.js';
import { genLatex, lintLatex, LATEX_KINDS } from './latex.js';

export async function apply(ctx: any) {
  // ---------------- rlab_validate ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_validate',
    description: 'Validate a research-wiki against the ΩmegaWiki contract: frontmatter schema (id/kind/title/updated), kind legality, id-filename consistency, [[wikilink]] bidirectional graph, dangling and isolated pages. Run after rlab_wiki batches or before publishing.'
    .replace(/ΩmegaWiki contract/, 'ΩmegaWiki contract'),
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
    },
    output: textOut,
    timeoutMs: 15000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      if (!project) throw new Error('project required');
      return validateWiki(project);
    },
  }));

  // ---------------- rlab_latex ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_latex',
    description: 'Scaffold a Chinese/English research LaTeX document (paper/thesis/NSFC skeleton with ctex + xeCJK preamble) or lint an existing .tex for common issues (unpaired begin/end, odd dollar count, quote style). Zero-dependency pure template registry (hono-style).'
    .replace(/hono-style/, 'hono-style'),
    parameters: {
      kind: { type: 'string', required: true, description: 'paper-zh | thesis-zh | nsfc-zh | paper-en' },
      title: { type: 'string', description: 'document title' },
      author: { type: 'string', description: 'author name' },
      affiliation: { type: 'string', description: 'affiliation (as \\thanks)' },
      keywords: { type: 'string', description: 'comma-separated keywords' },
      abstract: { type: 'string', description: 'abstract text' },
      text: { type: 'string', description: 'existing .tex content to lint (when set, lints instead of generating)' },
    },
    output: textOut,
    timeoutMs: 15000,
    async execute(args: any) {
      const kind = String(args?.kind ?? '').trim() as any;
      const text = String(args?.text ?? '').trim();
      if (text) return lintLatex(text);
      if (!LATEX_KINDS.includes(kind)) throw new Error('kind must be one of: ' + LATEX_KINDS.join(', '));
      return genLatex(kind, { title: args?.title, author: args?.author, affiliation: args?.affiliation, keywords: args?.keywords, abstract: args?.abstract });
    },
  }));

  // ---------------- rlab_wiki ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_wiki',
    description: 'Write a research-wiki page under <project>/.rlab/wiki/<kind>/ and rebuild the index (AutoSci-style durable lab notes). Kinds: experiment (what you ran), literature (paper notes), decision (why you chose X — ADRs), todo (open items). Pages are plain markdown; read them with the read tool. Returns the written path.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
      kind: { type: 'string', required: true, description: 'experiment | literature | decision | todo' },
      id: { type: 'string', required: true, description: 'short kebab id, e.g. m10-contrastive or arxiv-2602.04770' },
      title: { type: 'string', required: true, description: 'page title' },
      content: { type: 'string', required: true, description: 'markdown body' },
      tags: { type: 'array', description: 'optional tags' },
    },
    output: textOut,
    timeoutMs: 15000,
    async execute(args: any) {
      const kind = String(args?.kind ?? '') as WikiKind;
      if (!['experiment', 'literature', 'decision', 'todo'].includes(kind)) throw new Error('kind must be experiment|literature|decision|todo');
      const project = String(args?.project ?? '').trim();
      const id = String(args?.id ?? '').trim();
      if (!project || !id) throw new Error('project and id required');
      const p = writeWikiPage(project, {
        kind, id, title: String(args?.title ?? id), updated: today(),
        content: String(args?.content ?? ''), tags: args?.tags as string[] | undefined,
      });
      const idx = rebuildWikiIndex(project);
      let ix = '';
      try {
        addDoc(project, 'wiki/' + kind + '/' + id, String(args?.title ?? id) + '\n\n' + String(args?.content ?? ''), 'wiki');
        ix = '\nIndexed into related.db — now searchable via rlab_related.';
      } catch { ix = '\n(related.db index skipped — db unavailable)'; }
      return 'Wrote ' + p + '\nIndex: ' + idx + ix;
    },
  }));

  // ---------------- rlab_bench ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_bench',
    description: 'Append one evaluation row to the per-project benchmark ledger (<project>/.rlab/bench.jsonl) and return the report. ASI-Bench-grade rigor: you MUST state metric, split and (for MTEB) hf_subset — the tool flags 口径 (protocol) mismatches, e.g. comparing test vs dev splits, which is the classic self-deception in ML papers.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
      model: { type: 'string', required: true, description: 'model id, e.g. driftnet-m9 or potion-multilingual-128M' },
      task: { type: 'string', required: true, description: 'task name, e.g. STS12 or MTEB-Multilingual-v2' },
      score: { type: 'number', required: true, description: 'the metric value' },
      metric: { type: 'string', required: true, description: 'cos_sim.spearman | ndcg_at_10 | accuracy | ...' },
      split: { type: 'string', description: 'test | dev | validation (default test)' },
      hf_subset: { type: 'string', description: 'huggingface subset when task has one' },
      prompt_type: { type: 'string', description: 'e.g. query|passage, or none' },
      seed: { type: 'number', description: 'seed if stochastic' },
      note: { type: 'string', description: 'free note, e.g. "batch 128, fp32, compile off"' },
    },
    output: textOut,
    timeoutMs: 10000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      const model = String(args?.model ?? '').trim();
      const task = String(args?.task ?? '').trim();
      const score = Number(args?.score);
      if (!project || !model || !task || Number.isNaN(score)) throw new Error('project/model/task/score required');
      const row: BenchRow = {
        date: today(), model, task, score,
        metric: String(args?.metric ?? 'score'),
        split: String(args?.split ?? 'test'),
        hf_subset: args?.hf_subset ? String(args.hf_subset) : undefined,
        prompt_type: args?.prompt_type ? String(args.prompt_type) : undefined,
        seed: args?.seed !== undefined ? Number(args.seed) : undefined,
        note: args?.note ? String(args.note) : undefined,
      };
      appendBench(project, row);
      return benchReport(project, model, task);
    },
  }));

  // ---------------- rlab_experiment ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_experiment',
    description: 'Write an experiment page with a verdict-driven structure (hypothesis → prediction → evidence → verdict → conclusion). This encodes the discipline we learned the hard way: every experiment states its decision rule BEFORE the run, and records negative results with the same weight as positive ones. Page goes to <project>/.rlab/wiki/experiment/<id>.md.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
      id: { type: 'string', required: true, description: 'short kebab id, e.g. v4-permcons' },
      hypothesis: { type: 'string', required: true, description: 'what you believed and why (with references)' },
      prediction: { type: 'string', description: 'falsifiable prediction + decision rule, e.g. "STS12 >= 0.5 → mechanism works"' },
      evidence: { type: 'string', required: true, description: 'what actually happened: numbers, logs, artifacts' },
      verdict: { type: 'string', required: true, description: 'confirmed | refuted | inconclusive' },
      conclusion: { type: 'string', required: true, description: 'what this changes for the project' },
    },
    output: textOut,
    timeoutMs: 15000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      const id = String(args?.id ?? '').trim();
      const verdict = String(args?.verdict ?? '');
      if (!project || !id) throw new Error('project and id required');
      if (!['confirmed', 'refuted', 'inconclusive'].includes(verdict)) throw new Error('verdict must be confirmed|refuted|inconclusive');
      const body = [
        '## Hypothesis', '', String(args?.hypothesis ?? ''), '',
        '## Prediction / decision rule', '', String(args?.prediction ?? '(not stated — bad practice)'), '',
        '## Evidence', '', String(args?.evidence ?? ''), '',
        '## Verdict: **' + verdict.toUpperCase() + '**', '',
        '## Conclusion', '', String(args?.conclusion ?? ''), '',
      ].join('\n');
      const p = writeWikiPage(project, { kind: 'experiment', id, title: id + ' — ' + verdict, updated: today(), content: body });
      const idx = rebuildWikiIndex(project);
      return 'Wrote ' + p + '\nIndex: ' + idx;
    },
  }));

  // ---------------- rlab_paper_review ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_paper_review',
    description: 'Pull an arXiv paper by id (or abs URL) and produce a structured adversarial review checklist (ChatPaper summary + ASI-Bench rigor): contribution, method, evidence strength, baseline fairness, flaws, reproducibility. The checklist is the same one you should apply to your OWN paper before submission.',
    parameters: {
      arxivId: { type: 'string', required: true, description: 'e.g. 2602.04770 or full https://arxiv.org/abs/2602.04770 URL' },
      focus: { type: 'string', description: 'what to look for, e.g. "is the eval protocol sound?"' },
      outputFile: { type: 'string', description: 'optional absolute path to write the review markdown' },
    },
    output: textOut,
    timeoutMs: 60000,
    async execute(args: any) {
      const raw = String(args?.arxivId ?? '').trim();
      const m = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/);
      if (!m) throw new Error('could not parse arXiv id from: ' + raw);
      const papers = await arxivByIds([m[1]]);
      if (!papers.length) throw new Error('paper not found: ' + m[1]);
      const p = papers[0];
      const focus = args?.focus ? String(args.focus) : '';
      const lines = [
        '# Review: ' + p.title,
        '',
        'arXiv: ' + p.id + '  |  ' + p.absUrl,
        'Authors: ' + p.authors.join(', '),
        'Published: ' + p.published.slice(0, 10) + (p.updated && p.updated !== p.published ? ' (updated ' + p.updated.slice(0, 10) + ')' : ''),
        'Categories: ' + p.categories.join(', '),
        '',
        '## Abstract', '', p.summary, '',
        focus ? '## Review focus: ' + focus + '' : '',
        '',
        '## Checklist (answer each)',
        '',
        '1. **Contribution** — what is new vs prior work? Is the novelty structural or incremental?',
        '2. **Method** — is the method fully specified (hyperparams, data splits, compute)? Could you reimplement it from the text alone?',
        '3. **Evidence strength** — are the reported numbers backed by: same eval protocol across baselines? error bars / seeds? statistical tests?',
        '4. **Baseline fairness** — same preprocessing, same prompt templates, same split, same metric? Any cherry-picked subsets?',
        '5. **Known failure modes** — contamination (eval data in training), leakage, train/test split integrity, metric misuse (e.g. Pearson vs Spearman, accuracy on imbalanced sets).',
        '6. **Reproducibility** — code/data released? licenses? hardware and runtime reported?',
        '7. **Claims vs evidence** — does every headline claim have a corresponding table/figure with the exact protocol?',
        '8. **Missing experiments** — what ablation or control would you require before believing the central claim?',
        '',
        '## Verdict draft',
        '',
        '- [ ] Accept (strong evidence, sound protocol)',
        '- [ ] Weak accept (interesting but under-verified)',
        '- [ ] Borderline (fixable flaws: missing ablations, protocol gaps)',
        '- [ ] Reject (fatal flaw: broken protocol, no baseline, claims exceed evidence)',
        '',
        '_Generated by dsh-research-lab — the checklist also applies to your own papers._',
      ];
      const text = lines.join('\n');
      const outFile = args?.outputFile ? String(args.outputFile) : '';
      if (outFile) {
        fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
        fs.writeFileSync(outFile, text + '\n', 'utf8');
        return 'Review written to ' + outFile + '\n\n' + text;
      }
      return text;
    },
  }));

  // ---------------- rlab_arxiv_digest ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_arxiv_digest',
    description: 'Keyword digest of recent arXiv papers (daily-arXiv-ai-enhanced style). Searches export.arxiv.org for each query, dedupes, sorts by date, and writes a markdown digest under <project>/.rlab/digests/<date>.md. Use with rlab_wiki literature pages to build your reading queue.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
      queries: { type: 'array', required: true, description: 'search terms, e.g. ["embedding distillation", "efficient retrieval"]' },
      maxPerQuery: { type: 'number', description: 'papers per query (default 10, max 30)' },
      withSummary: { type: 'boolean', description: 'include 500-char abstracts (default false)' },
      wiki: { type: 'boolean', description: 'also write every paper as a literature wiki page and index into related.db (default false)' },
    },
    output: textOut,
    timeoutMs: 120000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      const queries: string[] = Array.isArray(args?.queries) ? args.queries.map(String).filter(Boolean) : [];
      if (!project || !queries.length) throw new Error('project and queries required');
      const max = Math.min(Number(args?.maxPerQuery) || 10, 30);
      const withSummary = args?.withSummary === true;
      const seen = new Set<string>();
      const all: Paper[] = [];
      for (const q of queries) {
        try {
          const papers = await arxivSearch(q, max);
          for (const p of papers) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            all.push(p);
          }
        } catch (e) {
          all.push({ id: 'ERR', title: 'query failed: ' + q + ' — ' + (e as Error).message, authors: [], published: '', updated: '', summary: '', categories: [], absUrl: '', pdfUrl: '' });
        }
      }
      all.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
      const date = today();
      const dir = path.join(rlabDir(project), 'digests');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, date + '.md');
      const lines = ['# arXiv digest — ' + date, '', 'queries: ' + queries.join(' | '), 'papers: ' + all.length, ''];
      lines.push(formatPapers(all, withSummary));
      fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
      let wikiCount = 0;
      if (args?.wiki === true) {
        const wseen = new Set<string>();
        for (const p of all) {
          if (!p.id || p.id === 'ERR' || wseen.has(p.id)) continue;
          wseen.add(p.id);
          try {
            const slug = p.id.replace(/[^\w-]+/g, '').slice(0, 60);
            const content = '## Title\n' + p.title + '\n\n## Authors\n' + (p.authors || []).join(', ').slice(0, 300) +
              '\n\n## Abstract\n' + (p.summary || '').slice(0, 1200) + '\n\n## Links\n- ' + (p.absUrl || '') + '\n- ' + (p.pdfUrl || '');
            writeWikiPage(project, { kind: 'literature', id: slug, title: String(p.title).slice(0, 120), updated: today(), content, tags: ['arxiv', ...(p.categories || []).slice(0, 3)] });
            addDoc(project, 'wiki/literature/' + slug, String(p.title) + '\n\n' + (p.summary || ''), 'arxiv:' + p.id);
            wikiCount++;
          } catch { /* skip single paper */ }
        }
      }
      return 'Digest written to ' + file + ' (' + all.length + ' papers' + (wikiCount ? ', ' + wikiCount + ' wiki pages written' : '') + ')\n\n' + formatPapers(all.slice(0, 10), withSummary);
    },
  }));

  // ---------------- rlab_writing ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_writing',
    description: 'Academic-expression check on a passage (nature-skills / research-writing-skill style). Flags: passive-voice overuse, weak verbs (get/do/make/use), vague quantifiers (many/some/very), overlong sentences, filler phrases, and inconsistent terminology. Returns a line-anchored report with concrete rewrites.',
    parameters: {
      text: { type: 'string', required: true, description: 'the passage to check' },
    },
    output: textOut,
    timeoutMs: 15000,
    async execute(args: any) {
      const text = String(args?.text ?? '').trim();
      if (!text) throw new Error('text required');
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      const weakVerbs = /\b(get|got|do|does|did|make|makes|made|use|uses|used|put|take|takes|took|show|shows|showed)\b/gi;
      const vague = /\b(many|some|several|a lot of|lots of|very|really|quite|fairly|pretty|kind of|sort of|basically|essentially|important|interesting|significant)\b/gi;
      const filler = /\b(in order to|due to the fact that|at this point in time|it is important to note that|as we all know|needless to say|it should be noted that)\b/gi;
      const passive = /\b(was|were|is|are|been|being) \w+ed\b/gi;
      const issues: string[] = [];
      const seen = new Set<string>();
      const push = (s: string) => { if (!seen.has(s)) { seen.add(s); issues.push(s); } };
      for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i];
        const words = s.split(/\s+/).length;
        if (words > 40) push('S' + (i + 1) + ' [' + words + ' words] overlong sentence — split it: "' + s.slice(0, 90) + '…"');
        const wv = s.match(weakVerbs);
        if (wv) push('S' + (i + 1) + ' weak verb(s) ' + [...new Set(wv.map(x => x.toLowerCase()))].join(', ') + ' — prefer precise verbs: "' + s.slice(0, 80) + '"');
        const vq = s.match(vague);
        if (vq) push('S' + (i + 1) + ' vague quantifier(s) ' + [...new Set(vq.map(x => x.toLowerCase()))].join(', ') + ' — replace with numbers or drop: "' + s.slice(0, 80) + '"');
        const fl = s.match(filler);
        if (fl) push('S' + (i + 1) + ' filler: ' + fl[0].toLowerCase() + ' → "' + s.slice(0, 80) + '"');
        const ps = s.match(passive);
        if (ps && words > 12) push('S' + (i + 1) + ' passive ' + ps[0].toLowerCase() + ' — consider active voice: "' + s.slice(0, 80) + '"');
      }
      // terminology consistency: repeated capitalized terms with variants
      const terms = text.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [];
      const freq = new Map<string, number>();
      for (const t of terms) freq.set(t, (freq.get(t) || 0) + 1);
      const multi = [...freq.entries()].filter(([, n]) => n >= 3).map(([t]) => t);
      const report = [
        '# Writing check report',
        '',
        'Sentences: ' + sentences.length + ' | issues found: ' + issues.length,
        '',
        issues.length ? issues.map(x => '- ' + x).join('\n') : '- ✅ No common issues detected.',
        '',
        multi.length ? '## Repeated key terms (check spelling/consistency): ' + multi.join(', ') : '',
        '',
        '## Quick checklist',
        '',
        '- One idea per sentence; < 30 words ideal.',
        '- Active voice: "we train" not "it was trained".',
        '- Numbers over adjectives: "57% (n=1,204)" not "many".',
        '- Define acronyms at first use; use ONE name per concept everywhere.',
        '- Claim only what a table/figure with a stated protocol supports.',
      ].join('\n');
      return report;
    },
  }));



  // ---------------- rlab_rewrite: deterministic writing rewrite engine ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_rewrite',
    description: 'Deterministic academic-writing rewrite engine (w-engine rules.ts spirit): applies ~10 curated rules — filler deletion (in order to→to, due to the fact that→because), weak verbs (get→obtain, make→produce, use→employ), passive "was X-ed by Y"→active, nominalizations, vague hedges. Returns before/after + per-rule hit counts. Offline, predictable, cheaper than LLM polishing.',
    parameters: {
      text: { type: 'string', required: true, description: 'the passage to rewrite' },
    },
    output: textOut,
    timeoutMs: 10000,
    async execute(args: any) {
      const text = String(args?.text ?? '').trim();
      if (!text) throw new Error('text required');
      return rewriteReport(text);
    },
  }));


  // ---------------- rlab_claim: claim extraction + evidence confidence ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_claim',
    description: 'Claim ledger with evidence confidence (w8 knowledge.ts/betaConfidence spirit). extract: pull structured claims (contribution/result/comparison — en+zh templates) from text or an indexed doc and append to <project>/.rlab/claims.jsonl with beta-posterior confidence (prior 0.5, weight 100). cite: increment citations of a claim → confidence rises. list: show the ledger. This is the evidence backbone for Related Work claims in your paper.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
      action: { type: 'string', required: true, description: 'extract | cite | list' },
      text: { type: 'string', description: 'paper text to extract from (action=extract)' },
      docId: { type: 'number', description: 'indexed doc id to extract from (action=extract)' },
      claimId: { type: 'number', description: 'claim id to cite (action=cite)' },
      type: { type: 'string', description: 'filter list by claim type' },
    },
    output: textOut,
    timeoutMs: 20000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      const action = String(args?.action ?? '').trim();
      if (!project || !action) throw new Error('project and action required');
      switch (action) {
        case 'extract': {
          let docId = 0;
          let textArg = String(args?.text ?? '');
          if (args?.docId !== undefined) {
            docId = Number(args.docId);
            const db = openDb(project);
            const row = db.prepare('SELECT title, body FROM docs WHERE id=?').get(docId) as { title: string; body: string } | undefined;
            if (!row) throw new Error('doc #' + docId + ' not found — index it with rlab_related action=add first');
            textArg = row.title + ' ' + row.body;
          }
          if (!textArg.trim()) throw new Error('text or docId required');
          const added = addClaims(project, docId, textArg);
          if (!added.length) return 'No claims matched the templates in this text. Templates: "we propose/present X", "achieves Y on Z", "outperforms W by V" (en+zh).';
          return 'Extracted ' + added.length + ' claims (confidences beta(0.5, cited=0)):\n\n' +
            added.map(c => '[' + c.id + '] ' + c.type.toUpperCase() + ' conf=' + c.confidence.toFixed(3) + '\n  subject: ' + (c.subject || '—') + (c.value ? '  value: ' + c.value : '') + (c.task ? '  on: ' + c.task : '')).join('\n');
        }
        case 'cite': {
          const claimId = Number(args?.claimId);
          if (!claimId) throw new Error('claimId required');
          const c = citeClaim(project, claimId);
          if (!c) throw new Error('claim #' + claimId + ' not found');
          return 'Cited claim #' + claimId + ' — confidence ' + c.confidence.toFixed(4) + ' (cited=' + c.cited + '). beta posterior rises with each citation.';
        }
        case 'list':
          return claimsReport(project, args?.type ? String(args.type) : undefined);
        default:
          throw new Error('action must be extract|cite|list');
      }
    },
  }));

  // ---------------- rlab_ref: shallow-clone + auto study note ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_ref',
    description: 'Shallow-clone a public GitHub repo and auto-generate a study note (REF.md): README/CLAUDE.md excerpts, 2-level tree, file count, absorption-decision table to fill in. The zero-config research habit: new reference project -> study note in seconds. Also indexable via rlab_related ingest.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root (refs go to <project>/.rlab/refs/)' },
      url: { type: 'string', required: true, description: 'github.com URL, e.g. https://github.com/skyllwt/AutoSci' },
    },
    output: textOut,
    timeoutMs: 150000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      const url = String(args?.url ?? '').trim();
      if (!project || !url) throw new Error('project and url required');
      const res = cloneAndStudy(url, path.join(rlabDir(project), 'refs'));
      return 'Cloned ' + res.repo + ' -> ' + res.dir + ' (' + res.files + ' files)' + String.fromCharCode(10)
        + 'Study note: ' + res.noteFile + String.fromCharCode(10) + String.fromCharCode(10)
        + '## README excerpt' + String.fromCharCode(10) + res.readme.slice(0, 400) + String.fromCharCode(10) + String.fromCharCode(10)
        + '## Structure' + String.fromCharCode(10) + res.tree.slice(0, 15).join(String.fromCharCode(10));
    },
  }));

  // ---------------- rlab_related: self-building keyword retrieval ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_related',
    description: 'Self-building keyword retrieval over a project document store (NLP + SQLite FTS5, zero deps). NO preset lexicon: terms are mined from the corpus via TF-IDF (English words + Chinese n-grams) and the lexicon grows with every added doc. Actions: add (index a doc), search (FTS5), expand (iterative relevance feedback: search → mine new terms from top hits → merge into query → repeat, rounds=1..4), keywords (show the auto-built lexicon), list (all docs). DB at <project>/.rlab/related.db.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
      action: { type: 'string', required: true, description: 'add | search | expand | keywords | list | ingest' },
      title: { type: 'string', description: 'doc title (add)' },
      body: { type: 'string', description: 'doc body/text (add)' },
      source: { type: 'string', description: 'origin, e.g. arxiv:2602.04770 or file path (add)' },
      query: { type: 'string', description: 'search query (search/expand), plain words, zh or en' },
      k: { type: 'number', description: 'results per round (default 8, max 20)' },
      rounds: { type: 'number', description: 'expansion rounds (default 2, max 4)' },
      external: { type: 'boolean', description: 'also mine suggestion terms from Wikipedia opensearch (en+zh, network; degrades silently offline)' },
      topN: { type: 'number', description: 'lexicon size for keywords (default 30)' },
      dir: { type: 'string', description: 'directory to bulk-ingest (ingest). Default: auto-detect .dsh-lib-analyzer/pages, .rlab/wiki, batch/out' },
    },
    output: textOut,
    timeoutMs: 60000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      const action = String(args?.action ?? '').trim();
      if (!project || !action) throw new Error('project and action required');
      const k = Math.min(Number(args?.k) || 8, 20);
      const rounds = Math.min(Number(args?.rounds) || 2, 4);
      const topN = Number(args?.topN) || 30;
      const fmt = (ds: RelatedDoc[]) => ds.map(d =>
        '• [' + d.id + '] ' + d.title + (d.source ? '  (' + d.source + ')' : '') + '  ' + d.added + '\n  ' + d.body.slice(0, 200).replace(/\n/g, ' ')).join('\n');
      switch (action) {
        case 'add': {
          const title = String(args?.title ?? '').trim();
          const body = String(args?.body ?? '').trim();
          if (!title || !body) throw new Error('title and body required for add');
          const id = addDoc(project, title, body, String(args?.source ?? ''));
          const kw = mineKeywords(project, 15);
          return 'Indexed doc #' + id + ': ' + title + '\nLexicon now ' + kw.length + ' top terms: ' + kw.slice(0, 10).map(x => x.term + '(' + x.score.toFixed(2) + ')').join(', ');
        }
        case 'search': {
          const q = String(args?.query ?? '').trim();
          if (!q) throw new Error('query required for search');
          const hits = search(project, q, k);
          if (!hits.length) return 'No hits for: ' + q + '\nTry expand (iterative keyword mining) or add more docs.';
          return 'FTS5 hits (' + hits.length + ') for: ' + q + '\n\n' + fmt(hits);
        }
        case 'expand': {
          const q = String(args?.query ?? '').trim();
          if (!q) throw new Error('query required for expand');
          let res = expandSearch(project, q, rounds, k);
          if (args?.external === true) {
            const ext = (await suggestExternal(q, 4)).concat(await suggestZh(q, 4));
            const extTerms = ext.map(e => e.term + '[' + e.source + ']').join(', ');
            if (ext.length) {
              const extHits = hybridSearch(project, ext.map(e => e.term).join(' OR '), k);
              res = { ...res, rounds: res.rounds.concat([{ round: res.rounds.length + 1, newTerms: ext.map(e => e.term), hits: extHits }]), final: extHits.length ? extHits : res.final };
            }
            return 'Iterative expansion (with external suggestions): ' + q + '\n  external terms: ' + (ext.length ? extTerms : '(none — offline?)') + '\n\n' + fmt(res.final);
          }
          const lines = ['Iterative expansion for: ' + q + '  (rounds=' + res.rounds.length + ')', ''];
          for (const rr of res.rounds) {
            lines.push('round ' + rr.round + ': ' + rr.hits.length + ' hits' + (rr.newTerms.length ? '  → mined new terms: ' + rr.newTerms.join(', ') : '  → lexicon saturated') );
          }
          lines.push('', '## Final hits', fmt(res.final));
          lines.push('', '## Auto-built lexicon (top ' + res.lexicon.length + ')', res.lexicon.slice(0, 15).map(x => x.term + '  score=' + x.score.toFixed(2) + ' freq=' + x.freq + ' docs=' + x.docs).join('\n'));
          return lines.join('\n');
        }
        case 'ingest': {
          const dir = String(args?.dir ?? '').trim();
          const cands = dir ? [dir] : [path.join(project, '.dsh-lib-analyzer', 'pages'), path.join(project, '.rlab', 'wiki'), path.join(project, 'batch', 'out')];
          const parts: string[] = [];
          let total = 0, skipped = 0;
          for (const cdir of cands) {
            if (!fs.existsSync(cdir)) { if (dir) throw new Error('dir not found: ' + cdir); continue; }
            const res = ingestDocDir(project, cdir);
            total += res.added; skipped += res.skipped;
            parts.push(path.basename(cdir) + ':+' + res.added);
          }
          return 'Ingested ' + total + ' files (skipped ' + skipped + ') — ' + (parts.join(' | ') || '(no ingest dirs found — pass dir=)') + '\nLexicon updated automatically. Try search or expand now.';
        }
        case 'keywords': {
          const kw = topKeywords(project, topN);
          if (!kw.length) return 'Lexicon empty — add docs first (rlab_related action=add).';
          return 'Auto-built lexicon (' + kw.length + '):\n' + kw.map(x => x.term + '  score=' + x.score.toFixed(2) + ' freq=' + x.freq + ' docs=' + x.docs + '  seen=' + x.last_seen).join('\n');
        }
        case 'list': {
          const db = openDb(project);
          const rows = db.prepare('SELECT id, title, source, added FROM docs ORDER BY id DESC LIMIT 50').all() as { id: number; title: string; source: string; added: string }[];
          if (!rows.length) return 'No docs indexed yet.';
          return 'Docs (' + rows.length + '):\n' + rows.map(x => '• #' + x.id + ' ' + x.title + (x.source ? '  (' + x.source + ')' : '') + '  ' + x.added).join('\n');
        }
        default:
          throw new Error('action must be add|search|expand|keywords|list|ingest');
      }
    },
  }));

  // ---------------- rlab_ocr: PaddleOCR document ingestion ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_ocr',
    description: 'Submit a document (local file path or http(s) URL) to PaddleOCR cloud and auto-ingest it into the research lab: downloads markdown + images into <project>/ocr/<name>/, indexes into related.db, optionally writes a literature wiki page. Models: PaddleOCR-VL-1.6 (all-round: complex layouts, flow charts) | PP-OCRv6 (light: fixed charts). Quality-max params enabled. Token from env PADDLE_OCR_TOKEN or ~/.dsh/paddle-ocr.token (never hardcoded). Free quota 20000 pages/day per model.',
    parameters: {
      file: { type: 'string', required: true, description: 'local file path or http(s) URL of the document (PDF/PNG/JPG...) to OCR' },
      model: { type: 'string', description: 'PaddleOCR-VL-1.6 (default, all-round) | PP-OCRv6 (light)' },
      project: { type: 'string', description: 'research project root — used for outDir/index/wiki (optional)' },
      outDir: { type: 'string', description: 'output dir for markdown+images (default <project>/ocr/<name>/ or ~/dsh-ocr/<name>/)' },
      index: { type: 'boolean', description: 'index the markdown into related.db (default true)' },
      wiki: { type: 'boolean', description: 'also write a literature wiki page (default false)' },
      maxWaitMs: { type: 'number', description: 'job poll timeout in ms (default 300000)' },
    },
    output: textOut,
    timeoutMs: 600000,
    async execute(args: any) {
      const file = String(args?.file ?? '').trim();
      if (!file) throw new Error('file required (local path or http(s) URL)');
      const model = (String(args?.model ?? 'PaddleOCR-VL-1.6').trim() as OcrModel);
      if (!OCR_MODELS.includes(model)) throw new Error('model must be ' + OCR_MODELS.join(' | '));
      const project = String(args?.project ?? '').trim();
      const t0 = Date.now();
      const job = await runOcr(file, model, { maxWaitMs: Number(args?.maxWaitMs) || 300000 });
      const base = path.basename(file).replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').slice(0, 60) || 'doc';
      const outDir = String(args?.outDir ?? '').trim() || (project ? path.join(project, 'ocr', base) : path.join(os.homedir(), 'dsh-ocr', base));
      const md = await fetchOcrMarkdown(job.jsonlUrl, outDir);
      const lines = ['✅ OCR done: ' + file,
        'model: ' + model + '  pages: ' + md.pages + '  chars: ' + md.chars + '  images: ' + md.images + '  time: ' + Math.round((Date.now() - t0) / 1000) + 's',
        'md: ' + md.mdPath];
      if (project && args?.index !== false) {
        const id = addDoc(project, 'ocr/' + base + '/doc.md', md.text, 'paddleocr:' + model);
        lines.push('indexed into related.db: doc #' + id);
      }
      if (project && args?.wiki === true) {
        const p = writeWikiPage(project, { kind: 'literature', id: base, title: base + ' (OCR)', updated: today(), content: md.text.slice(0, 4000) + '\n\n---\nSource: ' + file + ' (PaddleOCR ' + model + ')', tags: ['ocr'] });
        lines.push('wiki page: ' + p);
      }
      lines.push('quota note: 20000 free pages/day per model');
      return lines.join('\n');
    },
  }));

  // ---------------- rlab_absorb: lib-analyzer reports -> wiki pages ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_absorb',
    description: 'Auto-absorb dsh-lib-analyzer reports into the research wiki + related.db: scans batch/out and .dsh-lib-analyzer/pages for .md reports and writes each as a wiki page (kind=experiment by default) and indexes it. The zero-friction loop: libreport sinks a knowledge page -> run this -> it becomes wiki literature/experiment pages searchable via rlab_related.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
      dir: { type: 'string', description: 'directory to scan (default: auto-detect batch/out + .dsh-lib-analyzer/pages)' },
      kind: { type: 'string', description: 'wiki kind: experiment (default) | literature | decision' },
      max: { type: 'number', description: 'max reports to absorb (default 50)' },
    },
    output: textOut,
    timeoutMs: 60000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      if (!project) throw new Error('project required');
      const kind = String(args?.kind ?? 'experiment').trim();
      if (!['experiment', 'literature', 'decision'].includes(kind)) throw new Error('kind must be experiment|literature|decision');
      const max = Number(args?.max) || 50;
      const dirs = String(args?.dir ?? '').trim()
        ? [String(args?.dir).trim()]
        : [path.join(project, 'batch', 'out'), path.join(project, '.dsh-lib-analyzer', 'pages')];
      let written = 0, indexed = 0, skipped = 0;
      const files: string[] = [];
      for (const d of dirs) {
        if (!fs.existsSync(d)) continue;
        const walk = (p: string) => {
          for (const f of fs.readdirSync(p, { withFileTypes: true })) {
            if (f.name.startsWith('.')) continue;
            const full = path.join(p, f.name);
            if (f.isDirectory()) walk(full);
            else if (f.name.endsWith('.md') && files.length < max) files.push(full);
          }
        };
        walk(d);
      }
      for (const f of files) {
        try {
          const text = fs.readFileSync(f, 'utf8').slice(0, 20000);
          const rel = path.relative(project, f).replace(/\\/g, '/');
          const slug = path.basename(f, '.md').replace(/[^\w\u4e00-\u9fff-]+/g, '-').slice(0, 60) || 'report';
          writeWikiPage(project, { kind: kind as any, id: slug, title: slug + ' (absorbed)', updated: today(), content: text.slice(0, 5000) + '\n\n---\nSource: ' + rel, tags: ['absorb', path.basename(path.dirname(f))] });
          addDoc(project, rel, text, 'absorb');
          written++; indexed++;
        } catch { skipped++; }
      }
      return 'Absorbed ' + written + ' reports (' + files.length + ' found, ' + skipped + ' skipped) from: ' + (dirs.filter(d => fs.existsSync(d)).join(', ') || '(no dirs)') + '\nwiki pages: ' + written + ' | related.db docs: ' + indexed;
    },
  }));

  // ---------------- rlab_status ----------------
  ctx.tools.register(defineTool({
    name: 'rlab_status',
    description: 'One-screen state of a research project: wiki page counts per kind, benchmark ledger summary (models × tasks with latest scores), and open TODOs. Read this first when continuing work on a project.',
    parameters: {
      project: { type: 'string', required: true, description: 'absolute path to the research project root' },
    },
    output: textOut,
    timeoutMs: 10000,
    async execute(args: any) {
      const project = String(args?.project ?? '').trim();
      if (!project) throw new Error('project required');
      const dir = rlabDir(project);
      if (!fs.existsSync(dir)) return 'No .rlab/ directory at ' + project + ' yet. Start with rlab_wiki or rlab_bench.';
      const pages = listWiki(project);
      const count = (k: WikiKind) => pages.filter(p => p.kind === k).length;
      const benchRows = readBench(project);
      const todoPages = pages.filter(p => p.kind === 'todo');
      const lines = [
        '# Research status — ' + project,
        '',
        '## Wiki  (' + pages.length + ' pages)',
        '- experiments: ' + count('experiment'),
        '- literature: ' + count('literature'),
        '- decisions: ' + count('decision'),
        '- todo: ' + count('todo'),
        '',
        '## Bench (' + benchRows.length + ' rows)',
        '',
      ];
      lines.push(benchReport(project));
      lines.push('');
      if (todoPages.length) {
        lines.push('## Open TODOs');
        for (const t of todoPages) lines.push('- ' + t.title + '  (' + t.id + ')');
        lines.push('');
      }
      lines.push('_State dir: ' + dir + '_');
      return lines.join('\n');
    },
  }));
}