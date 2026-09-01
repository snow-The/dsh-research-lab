export interface Suggestion {
    term: string;
    source: string;
}
export declare function suggestExternal(query: string, max?: number): Promise<Suggestion[]>;
export declare function suggestZh(query: string, max?: number): Promise<Suggestion[]>;
