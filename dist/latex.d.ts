export type LatexKind = 'paper-zh' | 'thesis-zh' | 'nsfc-zh' | 'paper-en';
export interface LatexMeta {
    title?: string;
    author?: string;
    affiliation?: string;
    keywords?: string;
    abstract?: string;
    extra?: string;
}
export declare function genLatex(kind: LatexKind, meta?: LatexMeta): string;
export declare function lintLatex(text: string): string;
export declare const LATEX_KINDS: LatexKind[];
