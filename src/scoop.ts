/**
 * scoop.ts — the novelty audit: their Scoop-Check shape, our evidence trail.
 *
 * Structure adapted (not code) from microsoft/ResearchStudio-Idea's `scoop_check` skill
 * (arXiv 2607.04439, MIT): decompose a novelty claim into FOUR axes, search with THREE
 * complementary query families, triage by a 0-4 axis-overlap score, deep-dive the candidates that
 * match on the MECHANISM, compare against the claim, and state the delta.
 *
 * What this adds to a prompt: a page where the MISSING steps stay visible. Everything the caller
 * did not supply is rendered as 未做 / 未填 rather than omitted — a novelty audit that silently
 * skips the deep dive reads exactly like one that looked and found nothing.
 */

export interface ScoopHit { title: string; url?: string; detail?: string }
export type ScoopFamily = 'original-problem' | 'broad-domain' | 'method-signature';
export interface ScoopQuery { family: ScoopFamily; query: string; hits?: ScoopHit[] }
export interface ScoopAxes { problem?: string; mechanism?: string; insight?: string; domain?: string }
export interface ScoopCandidate { title: string; overlap?: number; notes?: string }
export interface ScoopArgs {
  claim: string;
  axes?: ScoopAxes;
  queries?: ScoopQuery[];
  candidates?: ScoopCandidate[];
  verdict?: 'novel' | 'collides' | 'unclear';
  delta?: string;
  notes?: string;
}

const AXES: [keyof ScoopAxes, string][] = [
  ['problem', 'Problem framing — 提出的问题是什么'],
  ['mechanism', 'Core mechanism — 真正做功的技术动作'],
  ['insight', 'Key insight — 为什么它应该成立'],
  ['domain', 'Application domain — 用在哪里'],
];
const FAMILIES: [ScoopFamily, string][] = [
  ['original-problem', 'Original-Problem — 复述原始研究问题'],
  ['broad-domain', 'Broad-Domain — 高层领域（3-5 词）'],
  ['method-signature', 'Method-Signature — 具体技术动作（5-8 词）'],
];

const DASH = '—（未填）';
const NOT_DONE = '未做';
const TICK = '✓';

/** Deterministic id: ASCII words become a slug, anything else falls back to a short hash. */
export function scoopSlug(claim: string): string {
  const ascii = String(claim ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (ascii.length >= 8) return ascii;
  let h = 5381;
  for (const ch of String(claim ?? '')) { h = (h * 33) ^ (ch.codePointAt(0) ?? 0); h = h >>> 0; }
  return 'scoop-' + h.toString(16).slice(0, 8);
}

/** The page body. Pure: the caller supplies the date and does the writing. */
export function renderScoop(a: ScoopArgs): string {
  const axes = a.axes ?? {};
  const filled = AXES.filter(([k]) => String(axes[k] ?? '').trim() !== '');
  const queries = Array.isArray(a.queries) ? a.queries : [];
  const doneFamilies = FAMILIES.filter(([f]) => queries.some((q) => q != null && q.family === f));
  const candidates = Array.isArray(a.candidates) ? a.candidates : [];
  const deep = candidates.filter((c) => c != null && typeof c.overlap === "number" && c.overlap >= 3);
  const L: string[] = [];
  const push = (...xs: string[]) => { for (const x of xs) L.push(x); };

  push('## 0. 判定摘要', '');
  push('- **主张**：' + (a.claim || DASH));
  push('- **判定**：' + (a.verdict ?? '未判定'));
  push('- **delta**：' + (String(a.delta ?? '').trim() || DASH));
  push('- **证据完备度**：四轴 ' + filled.length + '/4 · 查询族 ' + doneFamilies.length + '/3 · 候选 ' + candidates.length + ' 篇 · 机制重叠≥3 的 ' + deep.length + ' 篇');
  if (filled.length < 4 || doneFamilies.length < 3 || candidates.length === 0) {
    push('- **缺口**：这份审计并不完整 —— 下面标 ' + NOT_DONE + ' 的步骤不能读成“查过了、没有”。');
  }
  push('');

  push('## 1. 主张（要检验的新颖性）', '', a.claim || DASH, '');

  push('## 2. Step 1 — 四轴分解', '');
  push('| 轴 | 内容 |', '| :--- | :--- |');
  for (const [k, label] of AXES) {
    const v = String(axes[k] ?? '').trim();
    push('| ' + label + ' | ' + (v || DASH) + ' |');
  }
  push('', filled.length === 4 ? '四轴齐备。' : '四轴只填了 ' + filled.length + '/4 —— 空轴会让重叠评分失去意义。', '');

  push('## 3. Step 2 — 三个互补查询与证据', '');
  for (const [f, label] of FAMILIES) {
    const qs = queries.filter((q) => q != null && q.family === f);
    push('### ' + label, '');
    if (qs.length === 0) { push(NOT_DONE + '（这一族没有查询记录）', ''); continue; }
    for (const q of qs) {
      push('- 查询：' + '`' + String(q?.query ?? '') + '`');
      const hits = Array.isArray(q?.hits) ? (q.hits as ScoopHit[]) : [];
      if (hits.length === 0) { push('  - 无命中'); continue; }
      for (const h of hits.slice(0, 12)) {
        push('  - ' + (h?.title ?? '') + (h?.url ? ' — ' + h.url : '') + (h?.detail ? '  _' + h.detail + '_' : ''));
      }
    }
    push('');
  }

  push('## 4. Step 3-4 — 候选与重叠评分（0-4 = 命中几轴）', '');
  if (candidates.length === 0) {
    push(NOT_DONE + '（没有候选记录）', '');
  } else {
    push('| 候选 | 重叠 | 备注 |', '| :--- | ---: | :--- |');
    for (const c of candidates) {
      const o = c != null && typeof c.overlap === "number" ? String(c.overlap) : "?";
      push('| ' + (c?.title ?? '') + ' | ' + o + ' | ' + (c?.notes ?? '') + ' |');
    }
    push('', '重叠≥3（机制层面像的）应进入全文深读：' + (deep.length ? deep.map((c) => c.title).join('、') : '无'), '');
  }

  push('## 5. Step 5-7 — 深读、比较、delta', '');
  const deepNotes = candidates.some((c) => String(c?.notes ?? '').trim() !== '');
  push('- Step 5 全文深读：' + (deepNotes ? '有记录（见表内备注）' : NOT_DONE));
  push('- Step 6 与主张比较：' + (a.verdict ? '做了，判定 ' + a.verdict : NOT_DONE));
  push('- Step 7 delta 陈述：' + (String(a.delta ?? '').trim() ? '见 §0' : NOT_DONE));
  if (String(a.notes ?? '').trim()) push('', '补充：' + String(a.notes));
  push('');

  push('## 6. 方法出处', '');
  push('七步流程 / 四轴 / 三查询 / 0-4 重叠评分 取自 microsoft/ResearchStudio-Idea 的 `scoop_check` skill');
  push('（[arXiv 2607.04439](https://arxiv.org/abs/2607.04439)，MIT）。本页由 `rlab_scoop` 生成：它只负责');
  push('**结构与证据留痕**；检索由 dsh-search 的 `search_open` / `search_arxiv` 完成（各司其职）。');
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
}
