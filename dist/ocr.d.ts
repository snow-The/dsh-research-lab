export declare const OCR_MODELS: readonly ['PaddleOCR-VL-1.6', 'PP-OCRv6'];
export type OcrModel = (typeof OCR_MODELS)[number];
export declare function ocrToken(): string;
export interface OcrJob {
    jobId: string;
    jsonlUrl: string;
    pages: number;
    ms: number;
}
export declare function runOcr(file: string, model: OcrModel, opts?: {
    token?: string;
    maxWaitMs?: number;
    pollMs?: number;
}): Promise<OcrJob>;
export interface OcrMarkdown {
    mdPath: string;
    pages: number;
    images: number;
    chars: number;
    text: string;
}
export declare function fetchOcrMarkdown(jsonlUrl: string, outDir: string): Promise<OcrMarkdown>;
