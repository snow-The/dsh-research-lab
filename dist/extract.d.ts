export interface Claim {
    id: number;
    docId: number;
    type: 'contribution' | 'result' | 'comparison';
    subject: string;
    value?: string;
    task?: string;
    context: string;
    cited: number;
    confidence: number;
    date: string;
}
/**
 * One line of claims.jsonl. `owner` + `recordedAt` identify the writer and order the record.
 *
 * There is deliberately NO sequence number. A per-file monotonic `seq` cannot be allocated without
 * coordination: both "line count + 1" and "max(seq in file) + 1" let two parallel writers mint the
 * same number, and the only fix is an exclusive lock around every append. Ordering is a read-time
 * concern and needs no coordination at all, so the append path stays lock-free.
 */
export interface ClaimRecord extends Claim {
    owner: string;
    recordedAt: string;
    /** fingerprint (sha256[:16] of the replaced line) this record replaces; the old line stays on disk */
    supersedes?: string;
    /** legacy field: old files may carry one, this writer never assigns it (see the note above) */
    seq?: number;
}
export interface LoadClaimsOptions {
    /** also return versions that a later record supersedes (default: only the live version) */
    includeSuperseded?: boolean;
}
export declare function betaConfidence(prior: number, cited: number, weight?: number): number;
export declare function extractClaims(text: string): Omit<Claim, 'id' | 'cited' | 'confidence' | 'date' | 'docId'>[];
/**
 * Read the ledger. Superseded versions are filtered out by default; `includeSuperseded` returns the
 * whole history. Ordering is a READ-side concern (the file itself is never sorted): records come
 * back by id, ties broken by write order, so a parallel writer's record is never reordered away.
 */
export declare function loadClaims(project: string, opts?: LoadClaimsOptions): ClaimRecord[];
/**
 * Append ONE claim record. This is the only writer primitive for the ledger; it never rewrites the
 * file, and a record above the 4 KB atomic-append bound throws instead of being truncated.
 *
 * `id` is a human-friendly label, NOT a key: two writers that minted the same id both keep their
 * record (the ledger is a log, not a map). A caller that intends to REPLACE a record must pass
 * `supersedes` explicitly — citeClaim() does.
 */
export declare function appendClaim(project: string, claim: Partial<ClaimRecord>, owner?: string): ClaimRecord;
export declare function addClaims(project: string, docId: number, text: string, owner?: string): ClaimRecord[];
/**
 * Bump a claim's citation count by APPENDING a new version that supersedes the old line.
 *
 * The honest limit of a lock-free log: two simultaneous cites can both read cited=5 and both append
 * cited=6, so the stored VALUE may lag behind the number of citation records. No record is lost —
 * read with includeSuperseded and count the versions if you need the exact number.
 */
export declare function citeClaim(project: string, claimId: number, weight?: number, owner?: string): ClaimRecord | null;
export declare function claimsReport(project: string, type?: string, opts?: LoadClaimsOptions): string;
