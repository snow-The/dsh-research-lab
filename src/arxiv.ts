// arXiv API client (export.arxiv.org/api/query, Atom XML) — zero dependencies.
export interface Paper {
  id: string;            // e.g. 2602.04770
  title: string;
  authors: string[];
  published: string;
  updated: string;
  summary: string;
  categories: string[];
  absUrl: string;
  pdfUrl: string;
  comment?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function arxivQuery(params: Record<string, string>): Promise<Paper[]> {
  const qs = new URLSearchParams(params).toString();
  const url = 'https://export.arxiv.org/api/query?' + qs;
  const res = await fetch(url, { headers: { 'User-Agent': 'dsh-research-lab/0.1' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('arXiv HTTP ' + res.status);
  const xml = await res.text();
  const papers: Paper[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const grab = (tag: string) => {
      const t = e.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
      return t ? t[1].trim() : '';
    };
    const idRaw = grab('id'); // http://arxiv.org/abs/2602.04770v2
    const id = (idRaw.match(/\/abs\/([^\/]+)/) || [])[1] || idRaw;
    const title = grab('title').replace(/\s+/g, ' ').trim();
    const summary = grab('summary').replace(/\s+/g, ' ').trim();
    const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(x => x[1].trim());
    const categories = [...e.matchAll(/<category term="([^"]+)"/g)].map(x => x[1]);
    papers.push({
      id,
      title,
      authors,
      published: grab('published'),
      updated: grab('updated'),
      summary,
      categories,
      absUrl: 'https://arxiv.org/abs/' + id,
      pdfUrl: 'https://arxiv.org/pdf/' + id,
      comment: grab('arxiv:comment'),
    });
  }
  return papers;
}

// Search: id_list for known ids, all=<term> for keyword.
export async function arxivByIds(ids: string[]): Promise<Paper[]> {
  if (!ids.length) return [];
  return arxivQuery({ id_list: ids.join(','), max_results: String(ids.length) });
}

export async function arxivSearch(term: string, maxResults = 20, sortBy = 'submittedDate'): Promise<Paper[]> {
  return arxivQuery({ search_query: 'all:' + esc(term), start: '0', max_results: String(maxResults), sortBy, sortOrder: 'descending' });
}

export function formatPapers(papers: Paper[], withSummary = false): string {
  const lines: string[] = [];
  for (const p of papers) {
    lines.push('[' + p.id + '] ' + p.title);
    lines.push('  ' + p.absUrl);
    lines.push('  ' + (p.authors.slice(0, 6).join(', ') + (p.authors.length > 6 ? ' et al.' : '')));
    lines.push('  published ' + p.published.slice(0, 10) + ' | ' + p.categories.slice(0, 4).join(', '));
    if (withSummary) lines.push('  ' + p.summary.slice(0, 500));
    lines.push('');
  }
  return lines.join('\n').trim();
}
