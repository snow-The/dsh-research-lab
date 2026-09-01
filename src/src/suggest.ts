// External term suggestions — Wikipedia opensearch (free, keyless) as an extra
// expansion source for rlab_related expand. Network failures degrade silently.
export interface Suggestion { term: string; source: string; }

export async function suggestExternal(query: string, max = 5): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  try {
    const url = 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=' + max +
      '&search=' + encodeURIComponent(query);
    const res = await fetch(url, { headers: { 'User-Agent': 'dsh-research-lab/0.1' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return out;
    const data = await res.json() as unknown[];
    const terms = (data[1] as string[]) || [];
    for (const t of terms) out.push({ term: t, source: 'wikipedia' });
  } catch { /* offline — degrade silently */ }
  return out;
}

export async function suggestZh(query: string, max = 5): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  try {
    const url = 'https://zh.wikipedia.org/w/api.php?action=opensearch&format=json&limit=' + max +
      '&search=' + encodeURIComponent(query);
    const res = await fetch(url, { headers: { 'User-Agent': 'dsh-research-lab/0.1' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return out;
    const data = await res.json() as unknown[];
    const terms = (data[1] as string[]) || [];
    for (const t of terms) out.push({ term: t, source: 'wikipedia-zh' });
  } catch { /* offline */ }
  return out;
}
