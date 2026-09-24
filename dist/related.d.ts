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
export declare function hybridSearch(project: string, query: string, k?: number): RelatedDoc[];
/** One ledger row: the cheap change key and the doc/page it produced. */
export interface AbsorbRow {
    path: string;
    key: string;
    doc_id: number | null;
    page: string | null;
}
/** The absorb ledger for a project, keyed by project-relative path. */
export declare function absorbLedger(project: string): Map<string, AbsorbRow>;
/** Record a file as absorbed (upsert — the path is the identity, the key is its content state). */
export declare function recordAbsorbed(project: string, row: {
    path: string;
    key: string;
    docId?: number | null;
    page?: string | null;
}): void;
/**
 * Replace an existing indexed document in place. A report that CHANGED must not become a second row:
 * the old code inserted on every absorb, so one edited file appeared in the corpus as many times as
 * it was absorbed.
 */
export declare function updateDoc(project: string, id: number, title: string, body: string, source: string): boolean;
export declare function addDoc(project: string, title: string, body: string, source: string): number;
export declare function ingestDocDir(project: string, dir: string, maxFiles?: number): {
    added: number;
    skipped: number;
};
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
