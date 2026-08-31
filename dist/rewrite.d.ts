export interface RewriteRule {
    name: string;
    pattern: RegExp;
    replace: (m: RegExpExecArray) => string;
    reason: string;
}
export interface RewriteResult {
    before: string;
    after: string;
    applied: {
        name: string;
        reason: string;
        count: number;
    }[];
}
export declare function rewriteText(text: string): RewriteResult;
export declare function rewriteReport(text: string): string;
