export interface Paper {
    id: string;
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
export declare function arxivQuery(params: Record<string, string>): Promise<Paper[]>;
export declare function arxivByIds(ids: string[]): Promise<Paper[]>;
export declare function arxivSearch(term: string, maxResults?: number, sortBy?: string): Promise<Paper[]>;
export declare function formatPapers(papers: Paper[], withSummary?: boolean): string;
