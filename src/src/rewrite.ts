// Deterministic academic-writing rewrite engine (rule list, sequential apply).
// Inspired by w-engine/src/rules.ts (RewriteRule + replaceRepeated) — here rules are
// regex→replacement pairs with human-readable reasons; cheap, predictable, offline.
export interface RewriteRule {
  name: string;
  pattern: RegExp;
  replace: (m: RegExpExecArray) => string;
  reason: string;
}

export interface RewriteResult {
  before: string;
  after: string;
  applied: { name: string; reason: string; count: number }[];
}

const RULES: RewriteRule[] = [
  {
    name: 'filler-in-order-to',
    pattern: /\bin order to\b/gi,
    replace: () => 'to',
    reason: 'filler "in order to" → "to"',
  },
  {
    name: 'filler-due-to-the-fact',
    pattern: /\bdue to the fact that\b/gi,
    replace: () => 'because',
    reason: 'filler "due to the fact that" → "because"',
  },
  {
    name: 'filler-it-should-be-noted',
    pattern: /\bit (?:should be|is) (?:also )?noted that\b/gi,
    replace: () => '',
    reason: 'filler "it should be noted that" → delete',
  },
  {
    name: 'weak-get',
    pattern: /\bget(s|ting|t)?\b/gi,
    replace: (m) => (m[1] ? 'obtain' : 'obtain'),
    reason: 'weak verb get → obtain',
  },
  {
    name: 'weak-make',
    pattern: /\bmake(s|ing)?\b/gi,
    replace: (m) => (m[1] ? 'produce' : 'produce'),
    reason: 'weak verb make → produce',
  },
  {
    name: 'weak-use',
    pattern: /\buse(s|d|ing)?\b/gi,
    replace: () => 'employ',
    reason: 'weak verb use → employ (academic register)',
  },
  {
    name: 'passive-by',
    pattern: /\b([A-Z][\w\s-]{0,20}?)\s+(was|were) (\w+ed) by ([A-Z][\w\s]+?)(?=[\.\,]|$)/gi,
    replace: (m) => { const s = m[4].trim(); return s.charAt(0).toUpperCase() + s.slice(1) + ' ' + m[3]; },
    reason: 'passive "was X-ed by Y" → active "Y X-ed"',
  },
  {
    name: 'nominalization',
    pattern: /\b(performed|carried out|conducted) an? (experiment|study|analysis)\b/gi,
    replace: (m) => m[2] + ' (as verb: ' + (m[1].startsWith('perf') ? 'experimented' : 'studied') + ')',
    reason: 'nominalization → verb form',
  },
  {
    name: 'hedge-very',
    pattern: /\bvery (important|significant|large|small|good)\b/gi,
    replace: () => 'markedly',
    reason: 'vague "very X" → precise "markedly"',
  },
  {
    name: 'quantifier-many',
    pattern: /\ba (large )?number of\b/gi,
    replace: () => 'many',
    reason: 'wordy "a (large) number of" → "many"',
  },
];

export function rewriteText(text: string): RewriteResult {
  let cur = text;
  const applied: RewriteResult['applied'] = [];
  for (const rule of RULES) {
    const before = cur;
    cur = cur.replace(rule.pattern, (...args) => {
      const m = args as unknown as RegExpExecArray;
      return rule.replace(m);
    });
    const count = (before.match(new RegExp(rule.pattern.source, rule.pattern.flags)) || []).length;
    if (count > 0) applied.push({ name: rule.name, reason: rule.reason, count });
  }
  // post-pass: capitalize sentence starts (rules may lowercase after replacement)
  cur = cur.replace(/(^|[.!?]\s+)([a-z])/g, (m, pre: string, ch: string) => pre + ch.toUpperCase());
  return { before: text, after: cur, applied };
}

export function rewriteReport(text: string): string {
  const r = rewriteText(text);
  const lines = ['# Rewrite report', '', '## Applied rules (' + r.applied.length + ')'];
  for (const a of r.applied) lines.push('- ' + a.name + ' ×' + a.count + ' — ' + a.reason);
  if (!r.applied.length) lines.push('- (none — text is clean)');
  lines.push('', '## After', '', r.after, '', '## Diff (before → after)');
  const b = r.before.split('\n');
  const a = r.after.split('\n');
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    if (b[i] !== a[i]) lines.push('- ' + (b[i] ?? '').trim() + '  →  ' + (a[i] ?? '').trim());
  }
  return lines.join('\n');
}