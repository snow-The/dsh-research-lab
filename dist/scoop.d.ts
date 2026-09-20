/**
 * scoop.ts — the novelty audit: their Scoop-Check shape, our evidence trail.
 *
 * Structure adapted (not code) from microsoft/ResearchStudio-Idea's `scoop_check` skill
 * (arXiv 2607.04439, MIT): decompose a novelty claim into FOUR axes, search with THREE
 * complementary query families, triage by a 0-4 axis-overlap score, deep-dive the candidates that
 * match on the MECHANISM, compare against the claim, and state the delta.
 *
 * What this adds to a prompt: a page where the MISSING steps stay visible. Everything the caller
 * did not supply is rendered as 未做 / 未填 rather than omitted — a novelty audit that silently
 * skips the deep dive reads exactly like one that looked and found nothing.
 */
export interface ScoopHit {
    title: string;
    url?: string;
    detail?: string;
}
export type ScoopFamily = 'original-problem' | 'broad-domain' | 'method-signature';
export interface ScoopQuery {
    family: ScoopFamily;
    query: string;
    hits?: ScoopHit[];
}
export interface ScoopAxes {
    problem?: string;
    mechanism?: string;
    insight?: string;
    domain?: string;
}
export interface ScoopCandidate {
    title: string;
    overlap?: number;
    notes?: string;
}
export interface ScoopArgs {
    claim: string;
    axes?: ScoopAxes;
    queries?: ScoopQuery[];
    candidates?: ScoopCandidate[];
    verdict?: 'novel' | 'collides' | 'unclear';
    delta?: string;
    notes?: string;
}
/** Deterministic id: ASCII words become a slug, anything else falls back to a short hash. */
export declare function scoopSlug(claim: string): string;
/** The page body. Pure: the caller supplies the date and does the writing. */
export declare function renderScoop(a: ScoopArgs): string;
