export interface WikiIssue {
    page: string;
    severity: 'error' | 'warn';
    message: string;
}
export interface WikiGraph {
    edges: {
        from: string;
        to: string;
    }[];
    dangling: string[];
    isolated: string[];
}
export declare function validateWiki(project: string): string;
