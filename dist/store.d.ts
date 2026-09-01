export declare function rlabDir(project: string): string;
export type WikiKind = 'experiment' | 'literature' | 'decision' | 'todo';
export interface WikiPage {
    kind: WikiKind;
    id: string;
    title: string;
    updated: string;
    content: string;
    tags?: string[];
}
export declare function parseFrontmatter(text: string): Record<string, string | string[]>;
export declare function wikiPath(project: string, kind: WikiKind, id: string): string;
export declare function writeWikiPage(project: string, page: WikiPage): string;
export declare function listWiki(project: string): WikiPage[];
export declare function rebuildWikiIndex(project: string): string;
export interface BenchRow {
    date: string;
    model: string;
    task: string;
    metric: string;
    score: number;
    split?: string;
    hf_subset?: string;
    prompt_type?: string;
    seed?: number;
    note?: string;
}
export declare function benchFile(project: string): string;
export declare function appendBench(project: string, row: BenchRow): BenchRow[];
export declare function readBench(project: string): BenchRow[];
export declare function benchReport(project: string, model?: string, task?: string): string;
