
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
const ex4b = rel.expandSearch(PROJ, 'model 4b', 2, 5);
ok('expand with numeric token (4b) does not crash', ex4b.rounds.length > 0, String(ex4b.rounds.length));
ok('expand mines new terms', ex.rounds.length > 0 && ex.rounds.some(r => r.newTerms.length > 0), JSON.stringify(ex.rounds.map(r => r.newTerms)));

console.log('== 2. rlab_rewrite: rule engine ==');
const rw = rel.rewriteText('In order to improve results, we used a large number of samples. The model was evaluated by the committee.');
ok('filler + weak verb + quantifier', rw.after.includes('To improve') && rw.after.includes('employ') && rw.after.includes('many samples'), rw.after);
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

console.log('== 5. rlab_scoop: the novelty audit keeps its gaps visible ==');
const filled = rel.renderScoop({
  claim: 'Fold old context at the hard limit instead of the soft limit',
  axes: { problem: 'when to compact', mechanism: 'host-triggered fold', insight: 'cache invalidation dominates', domain: 'coding agents' },
  queries: [
    { family: 'original-problem', query: 'when to compact agent context', hits: [{ title: 'Compaction Provenance', url: 'https://example.org/a' }] },
    { family: 'broad-domain', query: 'agent memory management', hits: [] },
  ],
  candidates: [{ title: 'A folding policy', overlap: 3, notes: 'mechanism matches, domain differs' }],
  verdict: 'novel',
  delta: 'trigger placement, not the summary',
});
ok('filled audit says how complete it is', /四轴 4\/4 · 查询族 2\/3 · 候选 1 篇/.test(filled), (filled.split('\n')[5] || '').slice(0, 80));
ok('the missing query family is printed as 未做, not omitted', /Method-Signature[\s\S]{0,80}未做/.test(filled));
ok('an overlap>=3 candidate is called out for the deep dive', /机制层面像的[^\n]*A folding policy/.test(filled));
ok('the method is attributed', /arXiv 2607\.04439/.test(filled) && /ResearchStudio-Idea/.test(filled));

const bare = rel.renderScoop({ claim: '一个中文主张，用来验证 slug 回退与缺口提示' });
ok('an empty audit prints a GAP warning', /这份审计并不完整/.test(bare));
ok('unfilled axes are marked 未填', /—（未填）/.test(bare));
ok('every step is still listed (nothing silently skipped)', ['Step 1', 'Step 2', 'Step 3-4', 'Step 5-7'].every(s => bare.includes(s)));
ok('slug falls back to a hash for pure-CJK claims', /^scoop-[0-9a-f]{4,8}$/.test(rel.scoopSlug('一个中文主张')));
ok('slug is deterministic', rel.scoopSlug('Fold at the hard limit') === rel.scoopSlug('Fold at the hard limit'));

console.log('== 8. cap-index: dsh.v1.Index 客戶端（契約符合性） ==');
// 這一段不是測我們的程式有沒有照自己想的跑，是測**三種失敗有沒有分得開**。
// 合併任何兩種，呼叫方就會被送去修錯的東西——今天在 403 NO_GRANT 上剛付過代價。
const { createServer } = await import('node:http');

/** 起一個假 daemon；routes 決定每個 method 回什麼。 */
async function fakeDaemon(routes) {
  const server = createServer((req, res) => {
    const method = req.url.split('/').pop();
    const route = routes[method];
    if (route === undefined) {
      // 真的 Go mux 對不存在的路由回純文字，不是 JSON——客戶端必須靠這點判斷「服務不存在」。
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404 page not found');
      return;
    }
    const [status, body] = route(req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, stop: () => new Promise((resolve) => server.close(resolve)) };
}

const envOf = (port) => ({ baseUrl: `http://127.0.0.1:${port}`, source: 'test', token: 'test-token' });
const okInfo = { capabilities: ['index:fts5'], chunker: 'para-v1', contractVersion: 1, indexVersion: 1, service: 'dsh.v1.Index', version: '1' };

// 8a. 服務根本不存在 → SERVICE_ABSENT（不是 UNAUTHORIZED，也不是 UNAVAILABLE）
{
  const d = await fakeDaemon({});
  const probe = await rel.probeIndex(envOf(d.port));
  ok('absent service → SERVICE_ABSENT', probe.available === false && probe.code === 'SERVICE_ABSENT', JSON.stringify(probe));
  ok('absent service tells you to find the implementer, not retry', /not implemented|還沒有 Index/.test(rel.describeAvailability(probe)), rel.describeAvailability(probe));
  await d.stop();
}

// 8b. 服務端比較新（v2）→ 接受，並把它的版本號原樣露出
//     2026-11-01 服務端把 groupBy:"doc" 的 score 從 sum 改成 max（1 → 2）。
//     嚴格相等會讓每次 Index 呼叫都不可用，而本客戶端並不解釋 score，只轉述 semantics。
{
  const d = await fakeDaemon({ Info: () => [200, { ...okInfo, contractVersion: 2 }] });
  const probe = await rel.probeIndex(envOf(d.port));
  ok('newer contract is accepted (single lower bound, no upper bound)', probe.available === true, JSON.stringify(probe));
  ok('server contract version is reported verbatim', probe.available === true && probe.info.contractVersion === 2, JSON.stringify(probe.info && probe.info.contractVersion));
  await d.stop();
}

// 8b2. 服務端比較舊（v0）→ 仍拒絕：舊端可能缺我們依賴的欄位，不猜、不降級
{
  const d = await fakeDaemon({ Info: () => [200, { ...okInfo, contractVersion: 0 }] });
  const probe = await rel.probeIndex(envOf(d.port));
  ok('older contract → CONTRACT_MISMATCH', probe.available === false && probe.code === 'CONTRACT_MISMATCH', JSON.stringify(probe));
  ok('older contract reports both versions', probe.detail && probe.detail.client === 1 && probe.detail.server === 0, JSON.stringify(probe.detail));
  await d.stop();
}

// 8c. 有服務但拒絕 → UNAUTHORIZED，且不能講成「服務不存在」
{
  const d = await fakeDaemon({ Info: () => [401, { error: { code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' } }] });
  const probe = await rel.probeIndex(envOf(d.port));
  ok('authorization failure → UNAUTHORIZED', probe.available === false && probe.code === 'UNAUTHORIZED', JSON.stringify(probe));
  ok('authorization failure is not called absent', /身分|授權/.test(rel.describeAvailability(probe)), rel.describeAvailability(probe));
  await d.stop();
}

// 8d. 連不上 → UNAVAILABLE（與 absent 分開：一個該等，一個該找人）
{
  const probe = await rel.probeIndex({ baseUrl: 'http://127.0.0.1:9', source: 'test', token: '' }, 800);
  ok('connection failure → UNAVAILABLE', probe.available === false && probe.code === 'UNAVAILABLE', JSON.stringify(probe));
}

// 8e. Ingest：UNCHANGED 與 FAILED 必須是兩個狀態，不能併成一個 ok
{
  const d = await fakeDaemon({
    Ingest: () => [200, {
      documents: [
        { chunks: 2, id: 'a.md', status: 'INDEXED', textBytes: 40 },
        { chunks: 0, error: '', id: 'b.md', status: 'UNCHANGED', textBytes: 40 },
        { chunks: 0, error: 'disk full', id: 'c.md', status: 'FAILED', textBytes: 0 },
      ],
      failed: 1, indexVersion: 1, indexed: 1, rejected: 0, unchanged: 1,
    }],
  });
  const out = await rel.ingestDocuments(envOf(d.port), 'demo', [{ contentSha256: 'x', id: 'a.md', text: 'x' }]);
  const byId = Object.fromEntries((out.documents || []).map((x) => [x.id, x.status]));
  ok('unchanged survives as its own status', out.ok === true && byId['b.md'] === 'UNCHANGED', JSON.stringify(byId));
  ok('failed stays distinguishable from unchanged', byId['c.md'] === 'FAILED' && out.failed === 1, JSON.stringify(byId));
  ok('per-document error text is kept', (out.documents || []).find((x) => x.id === 'c.md')?.error === 'disk full');
  await d.stop();
}

// 8f. Search：三種狀態要分得開（hits / no-hits / not-indexed）
{
  const mk = (payload) => fakeDaemon({ Search: () => [200, payload] });
  const base = { chunker: 'para-v1', durationMs: 3, indexVersion: 1, normalizedQuery: 'q' };

  const d1 = await mk({ ...base, hits: [{ chunkOrdinal: 0, docId: 'a.md', score: 1.5, snippet: '量綱', snippetTruncated: false }], matchedDocuments: 1, namespaceDocuments: 5 });
  const h = await rel.searchIndex(envOf(d1.port), 'demo', '量綱');
  ok('hits → state=hits', h.ok === true && h.state === 'hits' && h.hits.length === 1, JSON.stringify(h).slice(0, 120));
  await d1.stop();

  const d2 = await mk({ ...base, hits: [], matchedDocuments: 0, namespaceDocuments: 5 });
  const n = await rel.searchIndex(envOf(d2.port), 'demo', '查無此字');
  ok('indexed but nothing matched → state=no-hits', n.ok === true && n.state === 'no-hits', String(n.state));
  await d2.stop();

  const d3 = await mk({ ...base, hits: [], matchedDocuments: 0, namespaceDocuments: 0 });
  const e = await rel.searchIndex(envOf(d3.port), 'demo', '查無此字');
  ok('never indexed → state=not-indexed (a different remedy)', e.ok === true && e.state === 'not-indexed', String(e.state));
  await d3.stop();
}

// 8g. 空 namespace 在本地就拒絕：不要讓呼叫方的 bug 變成基礎設施故障
{
  const out = await rel.ingestDocuments({ baseUrl: 'http://127.0.0.1:9', source: 'test', token: '' }, '  ', [{ contentSha256: 'x', id: 'a', text: 'x' }]);
  ok('empty namespace is rejected locally', out.ok === false && out.code === 'INVALID_REQUEST', JSON.stringify(out));
  const q = await rel.searchIndex({ baseUrl: 'http://127.0.0.1:9', source: 'test', token: '' }, '', 'x');
  ok('empty namespace on search is rejected locally too', q.ok === false && q.code === 'INVALID_REQUEST', JSON.stringify(q));
}

// 8h. 501 = 實作者說「這個方法還沒做」。不能讀成「服務不存在」，也不能讀成「回應壞了」。
//     （GAS 真的用 501 表達 Delete 第二批；若這裡讀錯，人會去修一個沒壞的東西。）
{
  const d = await fakeDaemon({ Delete: () => [501, { error: { code: 'NOT_IMPLEMENTED', message: 'Delete is the second batch' } }] });
  const out = await rel.deleteDocuments(envOf(d.port), 'demo', { docIds: ['a.md'] });
  ok('501 → NOT_IMPLEMENTED', out.ok === false && out.code === 'NOT_IMPLEMENTED', JSON.stringify(out).slice(0, 140));
  ok('501 is not reported as absent', /還沒實作/.test(rel.describeAvailability(out)), rel.describeAvailability(out));
  await d.stop();
}

// 8i. Delete 的成功路徑：契約回「刪了幾個」也回「還剩什麼」，兩個都要照抄，不要自己補 notFound
{
  const d = await fakeDaemon({
    Delete: () => [200, {
      deletedChunks: 3, deletedDocuments: 2, dryRun: false, durationMs: 4,
      indexVersion: 3, namespace: 'demo', remainingChunks: 7, remainingDocuments: 5,
    }],
  });
  const out = await rel.deleteDocuments(envOf(d.port), 'demo', { docIds: ['a.md', 'b.md'] });
  ok(
    'delete reports counts and what remains',
    out.ok === true && out.deletedDocuments === 2 && out.remainingDocuments === 5 && out.remainingChunks === 7,
    JSON.stringify(out),
  );
  ok('delete echoes the namespace and indexVersion it ran against', out.namespace === 'demo' && out.indexVersion === 3, JSON.stringify(out));
  await d.stop();
}

// 8j. **送出去的欄位名**必須與線上同名：`docIds` / `all`，而且**不得**送 `ids`。
//     真實 daemon 對 `ids` 回 400「要刪什麼？」——一個欄位兩個名字，下一個人就會送錯。
{
  const seen = [];
  const capture = (req) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk });
    req.on('end', () => seen.push(JSON.parse(raw)));
  };
  const d = await fakeDaemon({
    Delete: (req) => {
      capture(req);
      return [200, { deletedChunks: 0, deletedDocuments: 0, dryRun: false, indexVersion: 3, namespace: 'demo', remainingChunks: 0, remainingDocuments: 0 }];
    },
  });

  await rel.deleteDocuments(envOf(d.port), 'demo', { docIds: ['a.md'] });
  await rel.deleteDocuments(envOf(d.port), 'demo', { all: true });
  await rel.deleteDocuments(envOf(d.port), 'demo', { docIds: ['a.md'], dryRun: true });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await d.stop();

  ok('wire: first call sends docIds and never ids', seen[0]?.docIds?.[0] === 'a.md' && !('ids' in (seen[0] ?? {})), JSON.stringify(seen[0]));
  ok('wire: all=true is its own field, not a flag on docIds', seen[1]?.all === true && !('docIds' in (seen[1] ?? {})), JSON.stringify(seen[1]));
  ok('wire: dryRun is forwarded', seen[2]?.dryRun === true, JSON.stringify(seen[2]));
}

// 8k. 矛盾與空目標都在本地就被擋：連請求都不發
{
  const d = await fakeDaemon({ Delete: () => [200, { deletedChunks: 0, deletedDocuments: 0 }] });
  const both = await rel.deleteDocuments(envOf(d.port), 'demo', { docIds: ['a'], all: true });
  ok('docIds + all is rejected locally', both.ok === false && both.code === 'INVALID_REQUEST', JSON.stringify(both));
  const neither = await rel.deleteDocuments(envOf(d.port), 'demo', {});
  ok(
    'no target at all is rejected locally ("no target" is not "delete everything")',
    neither.ok === false && neither.code === 'INVALID_REQUEST' && /all=true/.test(neither.message),
    JSON.stringify(neither),
  );
  const emptyNs = await rel.deleteDocuments(envOf(d.port), '  ', { all: true });
  ok('empty namespace is rejected locally', emptyNs.ok === false && emptyNs.code === 'INVALID_REQUEST', JSON.stringify(emptyNs));
  await d.stop();
}

// 8l. 伺服器對舊名 `ids` 的 400，客戶端必須把**伺服器說的原因**帶出來。
//     「answered 400」不夠：那讓「我送錯欄位」與「伺服器吐了垃圾」長得一樣，
//     而 400 幾乎總是在說前者。
{
  const d = await fakeDaemon({
    Delete: () => [400, { error: { code: 'INVALID_ENVELOPE', message: 'INVALID_ENVELOPE: 要刪什麼？給 docIds，或 all=true' } }],
  });
  const out = await rel.deleteDocuments(envOf(d.port), 'demo', { docIds: ['a.md'] });
  ok(
    'a 400 surfaces the server code and message, not just "answered 400"',
    out.ok === false && out.code === 'BAD_RESPONSE' && /INVALID_ENVELOPE/.test(out.message) && /要刪什麼/.test(out.message),
    JSON.stringify(out).slice(0, 200),
  );
  await d.stop();
}

// 8m. `Info.semantics` 原樣帶過來：語意住在契約裡，客戶端不讀實作方的 README
{
  const semantics = {
    search: { limit: { default: 10, max: 100 }, ordering: 'score 降序；同分以 (docId, chunkOrdinal) 決勝', groupBy: 'chunk | doc' },
    delete: { target: 'docIds 或 all=true；空請求是 400' },
  };
  const d = await fakeDaemon({ Info: () => [200, { ...okInfo, semantics }] });
  const probe = await rel.probeIndex(envOf(d.port));
  ok(
    'Info.semantics is preserved, not dropped',
    probe.available === true && probe.info.semantics?.search?.limit?.max === 100,
    JSON.stringify(probe).slice(0, 200),
  );
  ok(
    'the meaning of limit is readable without any README',
    probe.available === true && /降序/.test(String(probe.info.semantics?.search?.ordering ?? '')),
    JSON.stringify(probe.info?.semantics ?? null).slice(0, 200),
  );
  await d.stop();
}

// 8n. 伺服器回報「我實際用了什麼」——要求 500 卻只回 100 筆時，呼叫方要能看出是夾鉗
{
  const seen = [];
  const d = await fakeDaemon({
    Search: (req) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk });
      req.on('end', () => seen.push(JSON.parse(raw)));
      return [200, {
        candidatesTruncated: true,
        chunker: 'gas-index-text-v2',
        durationMs: 2,
        groupBy: 'doc',
        hits: [{ chunkOrdinal: 0, docId: 'd1', kind: '', labels: {}, score: 0.7, snippet: '門鈴響了', snippetTruncated: false }],
        indexVersion: 3,
        limit: 100,
        matchedDocuments: 1,
        namespaceDocuments: 2,
        normalizedQuery: '門鈴',
        order: 'newest',
        returned: 1,
        staleDocuments: 2,
      }];
    },
  });
  const out = await rel.searchIndex(envOf(d.port), 'demo', '門鈴', { limit: 500 });
  ok(
    'the effective limit comes from the server, not from what we asked for',
    out.ok === true && out.limit === 100,
    JSON.stringify({ limit: out.limit, returned: out.returned }),
  );
  ok('returned / order / groupBy are surfaced', out.returned === 1 && out.order === 'newest' && out.groupBy === 'doc', JSON.stringify({ groupBy: out.groupBy, order: out.order, returned: out.returned }));
  ok('truncation and staleness are visible, not silent', out.candidatesTruncated === true && out.staleDocuments === 2, JSON.stringify({ stale: out.staleDocuments, truncated: out.candidatesTruncated }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  ok('we still send the caller’s request; the server owns clamping', seen[0]?.limit === 500, JSON.stringify(seen[0] ?? null).slice(0, 120));
  await d.stop();
}

console.log('\n===== RESULT: ' + pass + ' passed / ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);