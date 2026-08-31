import { DatabaseSync } from 'node:sqlite';
export interface RelatedDoc {
    id: number;
    title: string;
    body: string;
    source: string;
    added: string;
}
export interface KeywordHit {
    term: string;
    score: number;
    freq: number;
    docs: number;
    last_seen: string;
}
export declare function openDb(project: string): DatabaseSync;
export declare function tokenize(text: string): string[];
export declare function ftsText(text: string): string;
export declare function mineKeywords(project: string, topN?: number): KeywordHit[];
export declare function search(project: string, query: string, k?: number): RelatedDoc[];
export declare function addDoc(project: string, title: string, body: string, source: string): number;
export declare function topKeywords(project: string, topN?: number): KeywordHit[];
export declare function expandSearch(project: string, seed: string, rounds?: number, k?: number): {
    rounds: {
        round: number;
        newTerms: string[];
        hits: RelatedDoc[];
    }[];
    final: RelatedDoc[];
    lexicon: KeywordHit[];
};
