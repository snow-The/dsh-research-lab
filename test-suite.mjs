
import * as rel from 'file:///C:/Users/snow/.dsh-starter/plugins/dsh-research-lab/test-all.mjs';
import * as fs from 'node:fs';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); } };
const PROJ = 'C:/Users/snow/AppData/Local/Temp/rlab-t4';
fs.rmSync(PROJ, { recursive: true, force: true });

console.log('== 1. rlab_related: FTS5 + BM25 hybrid + expand ==');
const docs = [
  ['Knowledge Distillation Survey', 'Knowledge distillation compresses large teacher models into small student models while retaining accuracy. Logit matching and feature matching are the main transfer methods.', 'arxiv:2602.00001'],
  ['Drifting Distillation', 'Drifting distillation trains a compact student embedding model from a frozen teacher by matching the projected output distribution. Drift loss and covariance regularization prevent collapse.', 'arxiv:2602.04770'],
  ['位置编码与塌缩', '自注意力池化配合旋转位置编码在小批量漂移损失下会学习位置捷径,导致表示塌缩。置换一致性正则与高协方差正则可以缓解。', 'experiment:v4'],
  ['Compact Embedding Models', 'Embedding models for retrieval and semantic similarity need compact student networks. Matryoshka representations allow early exit at lower dimensions.', 'arxiv:2608.00099'],
];
for (const [t, body, src] of docs) rel.addDoc(PROJ, t, body, src);
const h1 = rel.hybridSearch(PROJ, 'distillation', 5).map(d => d.title);
ok('hybrid finds distillation docs', h1.some(t => t.includes('Distillation')), h1.join(','));
const h2 = rel.hybridSearch(PROJ, '塌缩 正则', 5).map(d => d.title);
ok('hybrid zh query finds collapse doc', h2.some(t => t.includes('塌缩')), h2.join(','));
const kw = rel.topKeywords(PROJ, 5);
ok('auto lexicon non-empty', kw.length > 0, kw.map(k => k.term).join(','));
const ex = rel.expandSearch(PROJ, 'compact student', 2, 5);
ok('expand mines new terms', ex.rounds.length > 0 && ex.rounds.some(r => r.newTerms.length > 0), JSON.stringify(ex.rounds.map(r => r.newTerms)));

console.log('== 2. rlab_rewrite: rule engine ==');
const rw = rel.rewriteText('In order to improve results, we used a large number of samples. The model was evaluated by the committee.');
ok('filler + weak verb + quantifier', rw.after.includes('to improve') && rw.after.includes('employ') && rw.after.includes('many samples'), rw.after);
ok('passive to active', rw.after.includes('The committee evaluated'), rw.after);
ok('rule report counts', rw.applied.length >= 4, JSON.stringify(rw.applied.map(a => a.name)));
ok('no-change passthrough', rel.rewriteText('Clean active sentence stays here.').applied.length === 0);

console.log('== 3. rlab_claim: extraction + beta confidence ==');
const paper = 'We propose a lightweight distillation method for compact embeddings. Our model achieves 0.55 on STS12 and outperforms the baseline by 12%. 本文提出一种轻量蒸馏方法用于紧凑嵌入表示。';
const claims = rel.extractClaims(paper);
ok('en contribution claim', claims.some(c => c.type === 'contribution' && c.subject.includes('lightweight distillation')), JSON.stringify(claims));
ok('en result claim with value+task', claims.some(c => c.type === 'result' && c.value === '0.55' && (c.task || '').includes('STS12')), JSON.stringify(claims));
ok('en comparison claim', claims.some(c => c.type === 'comparison' && c.value === '12%'), JSON.stringify(claims));
ok('zh contribution claim', claims.some(c => c.type === 'contribution' && c.subject.includes('轻量蒸馏')), JSON.stringify(claims));
const c0 = rel.betaConfidence(0.5, 0), c1 = rel.betaConfidence(0.5, 1), c100 = rel.betaConfidence(0.5, 100);
ok('beta 0 cited = prior', Math.abs(c0 - 0.5) < 1e-9, String(c0));
ok('beta 1 cited rises', c1 > c0, String(c1));
ok('beta 100 cited = 0.75 (prior weight 100)', Math.abs(c100 - 0.75) < 1e-9, String(c100));
const added = rel.addClaims(PROJ, 0, paper);
ok('claims persisted', added.length >= 3, String(added.length));
const cited = rel.citeClaim(PROJ, added[0].id);
ok('cite raises confidence', cited !== null && cited.confidence > added[0].confidence, cited ? cited.confidence.toFixed(4) : 'null');

console.log('== 4. suggest: external terms (network) ==');
try {
  const s = await rel.suggestExternal('knowledge distillation', 3);
  ok('wikipedia suggestions (may be offline)', s.length > 0, s.map(x => x.term).join(','));
} catch (e) { ok('wikipedia suggestions', false, String(e)); }

console.log('\n===== RESULT: ' + pass + ' passed / ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);