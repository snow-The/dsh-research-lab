export declare function rlabDir(project: string): string;
export declare const MAX_APPEND_RECORD_BYTES = 4096;
export declare class AppendRecordTooLargeError extends Error {
    readonly code = "APPEND_RECORD_TOO_LARGE";
    readonly file: string;
    readonly bytes: number;
    readonly limit: number;
    constructor(file: string, bytes: number, label?: string);
}
export declare function nowIso(): string;
/** The caller's session/agent id; 'unknown' when it did not supply one. Never invents an owner. */
export declare function ownerOf(owner: unknown): string;
/** sha256 of a raw JSON line, first 16 hex chars — the value a superseding record points at. */
export declare function lineFingerprint(rawLine: string): string;
/**
 * Identity of a version whose body may be split across several lines: sha256(at \0 owner \0 body).
 * Computing it from the reassembled parts (not from a line) is what lets a chunked record still be
 * superseded by a later one.
 */
export declare function entryFingerprint(at: string, owner: string, body: string): string;
/** Read a JSONL file tolerantly: a torn/foreign line is skipped, never fatal. Keeps line order. */
export declare function readJsonLines(file: string): {
    raw: string;
    value: any;
}[];
/** One append, one record. This is the atomic unit; never batch records into a larger buffer. */
export declare function appendJsonLine(file: string, record: unknown, label?: string): string;
export type WikiKind = 'experiment' | 'literature' | 'decision' | 'todo';
export interface WikiPage {
    kind: WikiKind;
    id: string;
    title: string;
    updated: string;
    content: string;
    tags?: string[];
    /** session/agent id of the writer; recorded in the page history, defaults to 'unknown'. */
    owner?: string;
}
export declare function parseFrontmatter(text: string): Record<string, string | string[]>;
export declare function wikiPath(project: string, kind: WikiKind, id: string): string;
/** The append-only version ledger of one page: one JSON record per write, never rewritten. */
export declare function wikiHistoryPath(project: string, kind: WikiKind, id: string): string;
export interface WikiHistoryEntry {
    at: string;
    owner: string;
    supersedes?: string;
    /** the exact page text (frontmatter + title + body) written at this version */
    body: string;
    /** entryFingerprint(at, owner, body) — the value a later version puts in `supersedes` */
    fingerprint: string;
    chunks: number;
    /** true when a LATER version replaced this one; the record itself is never deleted */
    superseded: boolean;
}
/** Read the version ledger of one page, in write order. Superseded versions stay readable. */
export declare function readWikiHistory(project: string, kind: WikiKind, id: string): WikiHistoryEntry[];
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
