
import * as rel from 'file:///C:/Users/snow/.dsh-starter/plugins/dsh-research-lab/test-all.mjs';
import * as fs from 'node:fs';
const PROJ = 'C:/Users/snow';  // gal2vec project root (wiki files live here)
fs.rmSync(PROJ + '/.rlab', { recursive: true, force: true });  // idempotent reruns
const line = s => console.log('\n' + '='.repeat(60) + '\n' + s + '\n' + '='.repeat(60));

line('1. rlab_related: 真实 gal2vec 论文/实验入库');
const docs = [
  ['Drifting (2602.04770)', 'Drifting distillation trains a compact student embedding model from a frozen teacher by matching the projected output distribution with a von Mises-Fisher kernel. Drift loss and covariance regularization prevent representation collapse. Static distillation from decoder-only teachers transfers next-token-prediction structure, not semantic ordering.', 'arxiv:2602.04770'],
  ['WeMM-4B teacher', 'WeMM-4B is a decoder-only large language model used as a frozen teacher. Its output projections are distilled into a 256-dimensional student with 1.3M parameters. The teacher representation space is dominated by next-token prediction and does not align with semantic similarity.', 'teacher:wemm-4b'],
  ['M9 collapse diagnosis', 'M9 使用旋转位置编码与注意力池化,在漂移损失下从第二轮起 STS12 就低于 0.22。位置捷径假设:可学习注意力池化放大位置信息导致方向错乱。v4 加入置换一致性正则后 STS12 提升到 0.3897,仍低于 potion128 的 0.644。', 'experiment:m9'],
  ['v4 best variant', '六个变体实验:机制切除全阴性(均值池化/无RoPE 均无改善),高协方差正则与置换一致性是唯一有效组合。v4 全任务超过 M9 两到三倍,但只有 potion128 的 40% 到 55%。', 'experiment:v4'],
  ['potion-multilingual-128M baseline', 'potion-multilingual-128M is a model2vec-style static distillation from bge-m3, an encoder teacher. Achieves 0.644 on STS12 and 0.718 on STSB. Chinese benchmarks: LCQMC 0.623, BQ 0.411, AFQMC 0.136.', 'baseline:potion128'],
];
for (const [t, body, src] of docs) {
  const id = rel.addDoc(PROJ, t, body, src);
  console.log('  + #' + id + ' ' + t);
}

line('2. hybridSearch: 中文检索 "表示塌缩"');
for (const d of rel.hybridSearch(PROJ, '旋转位置编码 注意力池化', 3)) console.log('  #' + d.id + ' ' + d.title);

line('3. expand: "compact student embedding" 迭代挖词');
const ex = rel.expandSearch(PROJ, 'compact student embedding', 2, 5);
ex.rounds.forEach((r, i) => console.log('  round' + (i + 1) + ': newTerms=[' + r.newTerms.join(', ') + '] hits=' + r.hits.length));
console.log('  final: ' + ex.final.map(d => d.title).join(' | '));

line('4. 自动词库 top10');
console.log(rel.topKeywords(PROJ, 10).map(k => '  ' + k.term + ' (score=' + k.score.toFixed(1) + ', docs=' + k.docs + ')').join('\n'));

line('5. rlab_claim: 从 Drifting 摘要抽 claim + 置信度');
const driftingAbs = 'We propose a drifting distillation method for compact embedding models. Our method achieves 0.644 on STS12 and outperforms logit-matching baselines by 15%. 本文提出漂移蒸馏方法用于紧凑嵌入模型,优于对数匹配基线。';
const claims = rel.extractClaims(driftingAbs);
console.log(claims.map(c => '  [' + c.type + '] subject=' + (c.subject || '-') + (c.value ? ' value=' + c.value + (c.task ? ' on=' + c.task : '') : '')).join('\n'));
const added = rel.addClaims(PROJ, 1, driftingAbs);
console.log('  persisted: ' + added.length + ' claims, conf=' + added.map(c => c.confidence.toFixed(3)).join('/'));
if (added.length) { const c2 = rel.citeClaim(PROJ, added[0].id); console.log('  cite #' + added[0].id + ' → conf=' + c2.confidence.toFixed(4)); }

line('6. rlab_rewrite: 论文草稿段落润色');
const draft = 'In order to prove our method, we used a large number of experiments. The evaluation was conducted by the benchmark suite. Our model was shown to achieve better results.';
const rw = rel.rewriteText(draft);
console.log('  BEFORE: ' + draft);
console.log('  AFTER : ' + rw.after);
console.log('  rules : ' + rw.applied.map(a => a.name + '×' + a.count).join(', '));

line('7. rlab_paper_review: 拉 Drifting 论文(网络)');
try {
  const papers = await rel.arxivByIds(['2602.04770']);
  if (papers.length) console.log('  [' + papers[0].id + '] ' + papers[0].title + '\n  ' + papers[0].absUrl + '\n  ' + papers[0].summary.slice(0, 200) + '…');
  else console.log('  (论文不存在或 arXiv 暂时不可达)');
} catch (e) { console.log('  FAIL: ' + e.message); }

line('8. rlab_arxiv_digest: 关键词 digest(网络)');
try {
  const papers = await rel.arxivSearch('embedding distillation', 3);
  console.log('  fetched ' + papers.length + ' papers:');
  for (const p of papers) console.log('  - [' + p.id + '] ' + p.title);
} catch (e) { console.log('  FAIL: ' + e.message); }
console.log('\n=== TRIAL DONE ===');