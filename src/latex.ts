// rlab_latex - Chinese research LaTeX scaffolding + linting
// hono-style: zero-dep pure functions over a template registry
export type LatexKind = 'paper-zh' | 'thesis-zh' | 'nsfc-zh' | 'paper-en';
export interface LatexMeta { title?: string; author?: string; affiliation?: string; keywords?: string; abstract?: string; extra?: string }
const PREAMBLE_ZH = [
  '\\documentclass[11pt,a4paper]{article}',
  '\\usepackage[UTF8]{ctex}',
  '\\usepackage{geometry}',
  '\\geometry{left=3.00cm,right=2.75cm,top=2.63cm,bottom=2.96cm}',
  '\\usepackage{amsmath,amssymb,amsfonts,bm}',
  '\\usepackage{graphicx,booktabs,multirow,array}',
  '\\usepackage{hyperref}',
  '\\CJKsetecglue{\\hskip 0.15em plus 0.05em minus 0.05em}',
  '\\setlength{\\parindent}{2em} \\usepackage{indentfirst}',
].join('\n');
const TITLES: Record<LatexKind, string> = {
  'paper-zh': '中文论文', 'thesis-zh': '学位论文', 'nsfc-zh': '基金申请书', 'paper-en': 'English Paper',
};
const BODY: Record<LatexKind, string> = {
  'paper-zh': '\\section{引言}\n\\section{方法}\n\\section{实验}\n\\section{结论}',
  'thesis-zh': '\\chapter{绪论}\n\\chapter{相关工作}\n\\chapter{方法}\n\\chapter{实验与讨论}\n\\chapter{结论与展望}',
  'nsfc-zh': '\\section{立项依据}\n\\section{研究内容与目标}\n\\section{研究方案与技术路线}\n\\section{创新点}',
  'paper-en': '\\section{Introduction}\n\\section{Method}\n\\section{Experiments}\n\\section{Conclusion}',
};
export function genLatex(kind: LatexKind, meta: LatexMeta = {}): string {
  const zh = kind !== 'paper-en';
  const lines: string[] = [];
  lines.push('% rlab_latex: ' + TITLES[kind] + ' skeleton (XeLaTeX)');
  lines.push(PREAMBLE_ZH);
  lines.push('\\title{' + (meta.title ?? '待定标题') + '}');
  lines.push('\\author{' + (meta.author ?? '作者') + (meta.affiliation ? '\\thanks{' + meta.affiliation + '}' : '') + '}');
  lines.push('\\date{\\today}');
  lines.push('\\begin{document}');
  lines.push('\\maketitle');
  if (meta.abstract) lines.push((zh ? '\\begin{abstract}' : '\\begin{abstract}') + meta.abstract + (zh ? '\\end{abstract}' : '\\end{abstract}'));
  if (meta.keywords) lines.push('\\noindent\\textbf{' + (zh ? '关键词' : 'Keywords') + ':} ' + meta.keywords);
  lines.push(BODY[kind]);
  if (meta.extra) lines.push(meta.extra);
  lines.push('\\end{document}');
  return lines.join('\n');
}
const PAIR: [RegExp, RegExp | null, string][] = [
  [/\\begin\{([a-z*]+)\}/g, /\\end\{([a-z*]+)\}/g, 'environment'],
  [/\$/g, null, 'math $'],
];
export function lintLatex(text: string): string {
  const issues: string[] = [];
  if (!/\\documentclass/.test(text)) issues.push('⚠️ 缺少 \\documentclass');
  if (/[""„“”]/.test(text)) issues.push('⚠️ 发现直引号/弯引号混用: 中文应使用 “ ” 或 “” 全角引号');
  const b = (text.match(/\\begin\{([a-z*]+)\}/g) ?? []).map(s => s.replace(/\\begin\{(.+)\}/, '$1'));
  const e = (text.match(/\\end\{([a-z*]+)\}/g) ?? []).map(s => s.replace(/\\end\{(.+)\}/, '$1'));
  for (const env of new Set([...b, ...e])) {
    const nb = b.filter(x => x === env).length, ne = e.filter(x => x === env).length;
    if (nb !== ne) issues.push('❌ begin/end 不配对: ' + env + ' (' + nb + '/' + ne + ')');
  }
  const ds = (text.match(/\$/g) ?? []).length;
  if (ds % 2 !== 0) issues.push('❌ $ 数量为奇数 (' + ds + '), 数学模式未闭合');
  if (text.includes('\\citep{') || text.includes('\\cite{')) issues.push('ℹ️ 引用建议使用 biblatex: \\addbibresource + \\parencite');
  if (text.includes('  ')) issues.push('ℹ️ 存在连续空格 (TeX 会折叠, 建议检查)');
  return issues.length ? issues.join('\n') : '✅ 未发现明显问题';
}
export const LATEX_KINDS: LatexKind[] = ['paper-zh', 'thesis-zh', 'nsfc-zh', 'paper-en'];