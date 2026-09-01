// PaddleOCR cloud job API — zero-dep client (global fetch/FormData/Blob).
// Token is NEVER hardcoded: env PADDLE_OCR_TOKEN or ~/.dsh/paddle-ocr.token (0600).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
export const OCR_MODELS = ['PaddleOCR-VL-1.6', 'PP-OCRv6'] as const;
export type OcrModel = (typeof OCR_MODELS)[number];

export function ocrToken(): string {
  const fromEnv = process.env.PADDLE_OCR_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const f = path.join(os.homedir(), '.dsh', 'paddle-ocr.token');
  try {
    const t = fs.readFileSync(f, 'utf8').trim();
    if (t) return t;
  } catch { /* fallthrough */ }
  throw new Error('PaddleOCR token not found — set env PADDLE_OCR_TOKEN or write it to ' + f);
}

// quality-max payloads (free quota: 20000 pages/day per model — spend it)
function bestPayload(model: OcrModel): Record<string, unknown> {
  if (model === 'PaddleOCR-VL-1.6') {
    return {
      useDocOrientationClassify: true,  // rotated / portrait text
      useDocUnwarping: true,            // curved/scan warping
      useLayoutDetection: true,         // full layout analysis (titles/paragraphs/figures/tables)
      useChartRecognition: true,        // charts incl. complex flow diagrams
      layoutDetModelName: 'large',
      layoutShapeMode: 'auto',
      showFormulaNumber: true,
      mergeTables: true,                // cross-page table merge
      relevelTitles: true,              // heading levels
      prettifyMarkdown: true,
      visualize: false,
    };
  }
  return {
    useDocOrientationClassify: true,
    useDocUnwarping: true,
    useTextlineOrientation: true,
    textDetLimitSideLen: 128,           // higher-res text detection (default 64)
    textDetLimitType: 'min',
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function submitLocal(abs: string, model: OcrModel, token: string): Promise<string> {
  const fd = new FormData();
  fd.append('model', model);
  fd.append('optionalPayload', JSON.stringify(bestPayload(model)));
  fd.append('file', new Blob([fs.readFileSync(abs)]), path.basename(abs));
  const resp = await fetch(JOB_URL, { method: 'POST', headers: { Authorization: 'bearer ' + token }, body: fd });
  if (resp.status !== 200) throw new Error('submit failed ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  const j = (await resp.json()) as { data: { jobId: string } };
  return String(j.data.jobId);
}

const CT_EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/tiff': 'tiff' };
async function downloadToTemp(file: string): Promise<string> {
  const r = await fetch(file, { headers: { 'User-Agent': 'Mozilla/5.0 dsh-research-lab' } });
  if (!r.ok) throw new Error('download failed ' + r.status);
  let name = path.basename(new URL(file).pathname) || 'doc';
  name = name.replace(/[^\w.-]+/g, '-');
  const OK_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
  const m = name.match(/\.([a-z0-9]{2,5})$/i);
  const ext = m ? m[1].toLowerCase() : '';
  if (!OK_EXT.includes(ext)) {
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const cext = CT_EXT[ct];
    if (!cext) throw new Error('unsupported content-type from URL: ' + ct);
    name = name.replace(/\.[^.]*$/, '') + '.' + cext;
  }
  const tmp = path.join(os.tmpdir(), 'rlab-ocr-' + Date.now() + '-' + name);
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  return tmp;
}

async function submitJob(file: string, model: OcrModel, token: string): Promise<string> {
  if (!/^https?:\/\//i.test(file)) {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) throw new Error('file not found: ' + abs);
    return submitLocal(abs, model, token);
  }
  // URL mode first; on rejection (server cannot fetch, e.g. arxiv) auto-download locally and retry
  const resp = await fetch(JOB_URL, {
    method: 'POST',
    headers: { Authorization: 'bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileUrl: file, model, optionalPayload: bestPayload(model) }),
  });
  if (resp.status === 200) {
    const j = (await resp.json()) as { data: { jobId: string } };
    return String(j.data.jobId);
  }
  const tmp = await downloadToTemp(file);
  try { return await submitLocal(tmp, model, token); }
  finally { try { fs.unlinkSync(tmp); } catch { /* best effort */ } }
}

export interface OcrJob { jobId: string; jsonlUrl: string; pages: number; ms: number }

export async function runOcr(file: string, model: OcrModel, opts: { token?: string; maxWaitMs?: number; pollMs?: number } = {}): Promise<OcrJob> {
  const token = opts.token ?? ocrToken();
  const started = Date.now();
  const jobId = await submitJob(file, model, token);
  const deadline = started + (opts.maxWaitMs ?? 300000);
  while (Date.now() < deadline) {
    await sleep(opts.pollMs ?? 5000);
    const r = await fetch(JOB_URL + '/' + jobId, { headers: { Authorization: 'bearer ' + token } });
    if (r.status !== 200) throw new Error('poll failed ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const j = (await r.json()) as { data: { state: string; resultUrl?: { jsonUrl: string }; extractProgress?: { extractedPages?: number }; errorMsg?: string } };
    const st = j.data.state;
    if (st === 'done') {
      const url = j.data.resultUrl?.jsonUrl;
      if (!url) throw new Error('job done but no result jsonUrl');
      return { jobId, jsonlUrl: url, pages: j.data.extractProgress?.extractedPages ?? 0, ms: Date.now() - started };
    }
    if (st === 'failed') throw new Error('OCR job failed: ' + (j.data.errorMsg ?? 'unknown error'));
    // pending / running: keep polling
  }
  throw new Error('OCR job timed out after ' + Math.round((Date.now() - started) / 1000) + 's (job ' + jobId + ')');
}

export interface OcrMarkdown { mdPath: string; pages: number; images: number; chars: number; text: string }

export async function fetchOcrMarkdown(jsonlUrl: string, outDir: string): Promise<OcrMarkdown> {
  fs.mkdirSync(outDir, { recursive: true });
  const r = await fetch(jsonlUrl);
  if (!r.ok) throw new Error('result download failed ' + r.status);
  const parts: string[] = [];
  let images = 0, chars = 0;
  for (const line of r.text ? (await r.text()).split('\n').filter(Boolean) : []) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    for (const res of obj.result?.layoutParsingResults ?? []) {
      const md: string = res.markdown?.text ?? '';
      if (md) { parts.push(md); chars += md.length; }
      const imgs: Record<string, string> = res.markdown?.images ?? {};
      for (const [rel, url] of Object.entries(imgs)) {
        try {
          const ir = await fetch(url);
          if (ir.ok) {
            const p = path.join(outDir, rel);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, Buffer.from(await ir.arrayBuffer()));
            images++;
          }
        } catch { /* image optional */ }
      }
    }
  }
  if (!parts.length) throw new Error('no markdown content in OCR result');
  const mdPath = path.join(outDir, 'doc.md');
  const text = parts.join('\n\n---\n\n');
  fs.writeFileSync(mdPath, text, 'utf8');
  return { mdPath, pages: parts.length, images, chars, text };
}
