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
export declare function betaConfidence(prior: number, cited: number, weight?: number): number;
export declare function extractClaims(text: string): Omit<Claim, 'id' | 'cited' | 'confidence' | 'date' | 'docId'>[];
export declare function loadClaims(project: string): Claim[];
export declare function addClaims(project: string, docId: number, text: string): Claim[];
export declare function citeClaim(project: string, claimId: number, weight?: number): Claim | null;
export declare function claimsReport(project: string, type?: string): string;
