// arXiv API client (export.arxiv.org/api/query, Atom XML) — zero dependencies.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

/**
 * THE SAME FILE dsh-search uses. That is the contract, not a coincidence: two plugins with two
 * private "last call" clocks are two clients as far as arXiv is concerned, which is exactly how a
 * polite 1.5s-retry client plus a polite 3s client added up to a burst and got the IP blocked.
 * info.arxiv.org: ~1 request per 3s, HTTP 503 when you exceed it, temporary IP block if you keep going.
 */
const THROTTLE_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.arxiv-throttle');
const MIN_GAP_MS = 3100;
async function gate(): Promise<void> {
  for (;;) {
    let last = 0;
    try { last = Number(readFileSync(THROTTLE_FILE, 'utf8')) || 0; } catch { last = 0; }
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  try { mkdirSync(dirname(THROTTLE_FILE), { recursive: true }); writeFileSync(THROTTLE_FILE, String(Date.now())); } catch { /* best effort */ }
}

/** Retry-After (seconds) is the server saying exactly how long to wait; ignoring it turns a soft
 *  limit into a block. Bounded so a hostile value cannot stall the tool. */
function retryAfterMs(header: string | null): number {
  const n = Number(String(header ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.min(n * 1000, 60000) : 0;
}

export async function arxivQuery(params: Record<string, string>): Promise<Paper[]> {
  const qs = new URLSearchParams(params).toString();
  const url = 'https://export.arxiv.org/api/query?' + qs;
  const fetchOne = () => {
    const headers = { 'User-Agent': 'dsh-research-lab/0.2 (local research agent; arxiv api client; +https://info.arxiv.org/help/api/)' };
    return fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  };
  const delays = [0, 4000, 12000];
  let res: Response | null = null;
  let asked = 0;
  let last = '';
  for (let i = 0; i < delays.length; i++) {
    const wait = Math.max(delays[i], i > 0 ? asked : 0);
    if (wait > 0) await sleep(wait);
    asked = 0;
    try {
      await gate();
      res = await fetchOne();
    } catch (err) {
      last = String((err as Error).message ?? err).slice(0, 120);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      asked = retryAfterMs(res.headers.get('retry-after'));
      last = 'HTTP ' + res.status + ' (arXiv rate limit: ~1 request per 3s; a burst gets the IP temporarily blocked)'
        + (asked ? '; server asked to wait ' + Math.round(asked / 1000) + 's' : '');
      continue;
    }
    if (!res.ok) throw new Error('arXiv HTTP ' + res.status);
    break;
  }
  if (res == null || !res.ok) throw new Error('arXiv: ' + (last || 'unreachable after 3 attempts'));
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