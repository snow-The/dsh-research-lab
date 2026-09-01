export interface RefResult {
    repo: string;
    dir: string;
    readme: string;
    claudeMd: string;
    tree: string[];
    files: number;
    noteFile: string;
}
export declare function cloneAndStudy(url: string, outDir: string, maxTree?: number): RefResult;
