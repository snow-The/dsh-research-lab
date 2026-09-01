// ΩmegaWiki contract validator (AutoSci-inspired):
// frontmatter schema check + [[wikilink]] bidirectional graph + dangling-link detection.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { listWiki, rlabDir, type WikiKind } from './store.js';

const KINDS: WikiKind[] = ['experiment', 'literature', 'decision', 'todo'];
const REQUIRED_FIELDS = ['id', 'kind', 'title', 'updated'];

export interface WikiIssue {
  page: string;
  severity: 'error' | 'warn';
  message: string;
}

export interface WikiGraph {
  edges: { from: string; to: string }[];
  dangling: string[];
  isolated: string[];
}

function parseFrontmatter(text: string): { meta: Record<string, string>; ok: boolean; err?: string } {
  if (!text.startsWith('---')) return { meta: {}, ok: false, err: 'missing YAML frontmatter (must start with ---)' };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, ok: false, err: 'unterminated frontmatter (missing closing ---)' };
  const block = text.slice(3, end).trim();
  const meta: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, ok: true };
}

export function validateWiki(project: string): string {
  const root = path.join(rlabDir(project), 'wiki');
  const issues: WikiIssue[] = [];
  const graph: WikiGraph = { edges: [], dangling: [], isolated: [] };
  const pages = listWiki(project);
  const idSet = new Set(pages.map(p => p.id));

  for (const kind of KINDS) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f === 'index.md') continue;
      const full = path.join(dir, f);
      const text = fs.readFileSync(full, 'utf8');
      const id = f.replace(/\.md$/, '');
      const fm = parseFrontmatter(text);
      if (!fm.ok) { issues.push({ page: kind + '/' + id, severity: 'error', message: fm.err! }); continue; }
      for (const field of REQUIRED_FIELDS) {
        if (!fm.meta[field]) issues.push({ page: kind + '/' + id, severity: 'error', message: 'frontmatter missing required field: ' + field });
      }
      if (fm.meta.kind && !KINDS.includes(fm.meta.kind as WikiKind)) {
        issues.push({ page: kind + '/' + id, severity: 'error', message: 'invalid kind: ' + fm.meta.kind });
      }
      if (fm.meta.id && fm.meta.id !== id) {
        issues.push({ page: kind + '/' + id, severity: 'error', message: 'frontmatter id "' + fm.meta.id + '" != filename "' + id + '"' });
      }
      // wikilinks
      const links = [...text.matchAll(/\[\[([A-Za-z0-9_.-]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1]);
      for (const to of links) {
        if (idSet.has(to)) graph.edges.push({ from: id, to });
        else graph.dangling.push(id + ' -> ' + to);
      }
    }
  }
  // backlink counts + isolated pages
  const backlinks = new Map<string, number>();
  for (const e of graph.edges) backlinks.set(e.to, (backlinks.get(e.to) || 0) + 1);
  for (const p of pages) {
    const out = graph.edges.filter(e => e.from === p.id).length;
    if (out === 0 && (backlinks.get(p.id) || 0) === 0) graph.isolated.push(p.id);
  }

  const lines = ['# Wiki validation — ' + project, ''];
  lines.push('pages: ' + pages.length + '   links: ' + graph.edges.length + '   issues: ' + issues.length);
  lines.push('');
  if (graph.dangling.length) {
    lines.push('## ⚠️ dangling links (' + graph.dangling.length + ')');
    for (const d of graph.dangling.slice(0, 20)) lines.push('- ' + d);
    lines.push('');
  }
  if (graph.isolated.length) {
    lines.push('## 🏝️ isolated pages (no links in or out)');
    for (const i of graph.isolated.slice(0, 20)) lines.push('- ' + i);
    lines.push('');
  }
  if (issues.length) {
    lines.push('## ❌ issues (' + issues.length + ')');
    for (const i of issues) lines.push('- [' + i.severity + '] ' + i.page + ': ' + i.message);
  } else {
    lines.push('## ✅ all pages pass the ΩmegaWiki contract');
  }
  lines.push('');
  lines.push('### top backlinked');
  const top = [...backlinks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [id, n] of top) lines.push('- ' + id + '  (' + n + ' backlinks)');
  return lines.join('\n');
}
