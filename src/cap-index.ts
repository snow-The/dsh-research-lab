/**
 * cap-index.ts — `dsh.v1.Index` 能力的薄客戶端（零依賴，只用 fetch）。
 *
 * 為什麼放在這個插件而不是各插件複製一份：
 *   我們的問題正是「同一支東西複製到五個插件」。所以第一個採用者內建它，
 *   **第二個採用者出現時就必須把它抽成獨立套件**——不要讓它也變成第六份拷貝。
 *   觸發條件寫在這裡，避免它默默變成新的債。
 *
 * 這個檔案的兩個用途：
 *   1. 客戶端：服務上線後，`related.ts` 的 FTS5/BM25 可以整段換成呼叫它。
 *   2. **符合性測試台**：它對契約的每一條不變量都有明確反應，
 *      GAS 的實作可以直接拿 test-suite 的 cap-index 段當驗收。
 *
 * 三條規矩（違反任何一條，這個客戶端就變成噪音）：
 *   A. 「沒這個服務」與「服務說你沒授權」與「契約版本不符」是三件事，不可合併。
 *   B. `UNCHANGED` 是結果，`FAILED` 是錯誤。前者不進錯誤通道。
 *   C. 不降級、不猜：契約版本不符就拒絕執行並回報兩個版本號。
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 這個客戶端依賴的**最低**契約版本（單一下界，無上界——與插件的 `engines.dsh: ">=0.2.1-rc.2"` 同一條規矩）。
 *
 * 為什麼不再要求「必須相等」：2026-11-01 服務端把 `groupBy:"doc"` 的 score 從 sum 改成 max
 * （語意變更，contractVersion 1 → 2）。嚴格相等讓**每一次** Index 呼叫都變成 CONTRACT_MISMATCH，
 * 而這個客戶端根本不解釋 score——它只把 `semantics` 原樣轉述給呼叫方。用嚴格相等去擋一個
 * 自己不消費的欄位，換來的只是全面不可用。
 *
 * 規則：`server < MIN` 拒絕（舊服務端可能缺我們依賴的欄位）；`server >= MIN` 接受，
 * 並把兩邊版本都留在 `info.contractVersion` 與失敗訊息裡，讓呼叫方自己判斷要不要用新語意。
 */
export const MIN_CONTRACT_VERSION = 1

/** @deprecated 舊名，保留以免呼叫方斷裂；語意已從「必須相等」改為「最低版本」。 */
export const EXPECTED_CONTRACT_VERSION = MIN_CONTRACT_VERSION

const SERVICE = 'dsh.v1.Index'
const DEFAULT_TIMEOUT_MS = 15_000

export interface CapIndexEnv {
  baseUrl: string
  token: string
  /** 從哪裡解析出來的，供診斷顯示；不要用它做分支。 */
  source: string
}

/** 解析 daemon 位址與 token。每次呼叫都重讀 port/token：它們會被重新配發。 */
export function resolveEnv(opts: { dshHome?: string; baseUrl?: string; timeoutMs?: number } = {}): CapIndexEnv {
  const dshHome = opts.dshHome ?? join(homedir(), '.dsh')
  const busDir = join(dshHome, 'session-bus')

  const read = (file: string): string => {
    try {
      return readFileSync(join(busDir, file), 'utf8').trim()
    } catch {
      return ''
    }
  }

  let baseUrl = opts.baseUrl ?? process.env.DSH_CAP_URL ?? ''
  if (baseUrl === '') {
    const port = read('port')
    baseUrl = /^\d+$/.test(port) ? `http://127.0.0.1:${port}` : ''
  }
  return { baseUrl, source: baseUrl === '' ? 'unresolved' : baseUrl, token: read('token') }
}

export type FailureCode =
  /** 這個 daemon 根本沒有 Index 服務（路由不存在）——不是錯誤，是「還沒實作」。 */
  | 'SERVICE_ABSENT'
  /** 有服務，但 token 不對或沒授權。身分問題。 */
  | 'UNAUTHORIZED'
  /** 服務在，但契約版本不同。拒絕執行，回報兩個版本號。 */
  | 'CONTRACT_MISMATCH'
  /** 連不上：daemon 沒跑、port 檔不見、逾時。 */
  | 'UNAVAILABLE'
  /** 服務回了 200 但不是我們認得的形狀。 */
  | 'BAD_RESPONSE'
  /**
   * 服務在、方法也登記了，但**刻意還沒實作**（實作方用 501 表達，例如 Delete 第二批）。
   * 必須與 SERVICE_ABSENT 分開（「還沒做」≠「這台機器沒有這個能力」），
   * 也必須與 BAD_RESPONSE 分開（那不是回應壞了，是實作者明說了不要依賴它）。
   */
  | 'NOT_IMPLEMENTED'
  /** 請求本身有問題（例如空 namespace）。呼叫方修呼叫，不要重試。 */
  | 'INVALID_REQUEST'

export interface Failure {
  ok: false
  code: FailureCode
  message: string
  detail?: Record<string, unknown>
}

export const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && (value as Failure).ok === false

export interface IndexInfo {
  capabilities: string[]
  chunker: string
  contractVersion: number
  defaultLimit: number
  indexVersion: number
  maxDocumentsPerIngest: number
  maxLimit: number
  maxTextBytesPerDocument: number
  /**
   * 伺服器自己對「這些數字什麼意思」的說明（`Info.semantics`）：`limit` 的預設與上限、
   * 排序規則、`groupBy` 的兩種模式、`matchedDocuments` 與 `namespaceDocuments` 的差別……
   *
   * 為什麼要原樣帶過來：**語意必須住在契約看得見的地方，不能只住實作方的 README**。
   * 客戶端不讀 README 也能正確翻頁——這正是 GAS 的 V3 要解決的事，這裡只是不再把它丟掉。
   */
  semantics?: Record<string, unknown>
  service: string
  version: string
}

export interface IndexDocument {
  id: string
  text: string
  contentSha256: string
  kind?: string
  labels?: Record<string, string>
  textBytes?: number
}

/**
 * 逐份狀態。**這是契約的核心**：`UNCHANGED` 與 `FAILED` 必須分得開。
 * 把它們併成一個 `ok`，報表數字就會對不上，而那是我們已經付過代價的失敗。
 */
export type DocumentStatus = 'INDEXED' | 'UNCHANGED' | 'FAILED' | 'REJECTED' | 'UNKNOWN'

export interface DocumentOutcome {
  id: string
  status: DocumentStatus
  chunks: number
  error: string
  textBytes: number
}

export interface IngestOutcome {
  ok: true
  documents: DocumentOutcome[]
  failed: number
  indexed: number
  indexVersion: number
  rejected: number
  unchanged: number
}

export interface IndexHit {
  /** chunk 模式才有；doc 模式（`groupBy`）回的是文件級條目，這個欄位不存在。 */
  chunkOrdinal?: number
  docId: string
  kind: string
  labels: Record<string, string>
  score: number
  snippet: string
  snippetTruncated: boolean
  // ---- doc 模式（`groupBy: "doc"`）才有的欄位 ----
  /** 最高分區塊在該文件中的序號。 */
  bestChunkOrdinal?: number
  /** 最高單一區塊分數。`score` 只在 `docAggregation:"max"` 時等於它；
   *  `"sum"` 與 `"mean"` 下都不是（sum 是所有命中塊之和、mean 是它們的均值）。 */
  bestChunkScore?: number
  /** 這份文件被切成幾塊（長度偏誤的來源，呼叫方要自己看）。 */
  chunkCount?: number
  /** 這次查詢命中幾塊。`score/sum` 用得到它，`score/max` 用不到。 */
  matchedChunkCount?: number
}

/**
 * 檢索結果一定帶 `state`。呼叫方不該自己去比對兩個計數——
 * 「索引過但 0 命中」與「這裡根本還沒索引」的處置完全不同，
 * 而混為一談正是使用者會換三次關鍵字的來源。
 */
export type SearchState = 'hits' | 'no-hits' | 'not-indexed'

export interface SearchOutcome {
  ok: true
  /** `true` ＝候選命中上限，結果可能不完整——不是「只有這些」（契約原文）。 */
  candidatesTruncated: boolean
  chunker: string
  durationMs: number
  /** 這次實際用的分組方式（`chunk` 或 `doc`）——由伺服器回報，不是客戶端假設。 */
  groupBy: string
  /**
   * doc 模式下伺服器實際用的聚合方式（`max` / `sum`）。伺服器回什麼就轉什麼，
   * 客戶端**不解釋** `score`——同一個數字在兩種聚合下意思不同，解釋權在伺服器的 `semantics`。
   */
  docAggregation?: string
  hits: IndexHit[]
  indexVersion: number
  /** **伺服器實際採用的 limit**。要求 500 而得到 100 時，這裡是 100（契約夾鉗，不是靜默改寫）。 */
  limit: number
  matchedDocuments: number
  namespaceDocuments: number
  normalizedQuery: string
  /** 這次實際用的排序方向。語意住在伺服器的 `Info.semantics`，客戶端只轉述。 */
  order: string
  /** 這次回了幾筆（`hits.length` 的伺服器版本，用來對照 limit）。 */
  returned: number
  staleDocuments: number
  state: SearchState
}

export interface StatsOutcome {
  ok: true
  namespaces: {
    chunks: number
    documents: number
    indexVersion: number
    lastIngestUnixMs: number
    namespace: string
    textBytes: number
  }[]
  storeBytes: number
}

interface CallOutcome {
  body: Record<string, unknown> | null
  failure?: Failure
  status: number
}

async function call(env: CapIndexEnv, method: string, payload: Record<string, unknown>, timeoutMs: number): Promise<CallOutcome> {
  if (env.baseUrl === '') {
    return {
      body: null,
      failure: {
        code: 'UNAVAILABLE',
        message: 'cannot locate the capability daemon: no port file under ~/.dsh/session-bus and no DSH_CAP_URL',
        ok: false,
      },
      status: 0,
    }
  }

  const headers: Record<string, string> = { 'connect-protocol-version': '1', 'content-type': 'application/json' }
  if (env.token !== '') headers.authorization = `Bearer ${env.token}`

  let response: Response
  try {
    response = await fetch(`${env.baseUrl}/${SERVICE}/${method}`, {
      body: JSON.stringify(payload),
      headers,
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // 連不上（daemon 沒跑、逾時）與「服務不存在」是兩件事：前者過一會再試，
    // 後者要去找實作者。合併會讓呼叫方重試一個永遠不會出現的東西。
    const message = error instanceof Error ? error.message : String(error)
    return { body: null, failure: { code: 'UNAVAILABLE', message: `cannot reach ${env.baseUrl}: ${message}`, ok: false }, status: 0 }
  }

  const text = await response.text()
  let body: Record<string, unknown> | null = null
  try {
    body = text === '' ? null : (JSON.parse(text) as Record<string, unknown>)
  } catch {
    // 非 JSON 幾乎都代表「這條路由不存在」：Go 的 mux 回 "404 page not found"。
    if (response.status === 404) {
      return {
        body: null,
        failure: {
          code: 'SERVICE_ABSENT',
          message: `${SERVICE} is not implemented on this daemon (404 for ${method}); nothing to degrade from — the service simply is not there`,
          ok: false,
        },
        status: 404,
      }
    }
    return {
      body: null,
      failure: { code: 'BAD_RESPONSE', message: `non-JSON reply (${response.status}) from ${SERVICE}/${method}: ${text.slice(0, 160)}`, ok: false },
      status: response.status,
    }
  }

  if (response.status === 401 || response.status === 403) {
    const serverCode = (body?.error as { code?: unknown } | undefined)?.code
    return {
      body,
      failure: {
        code: 'UNAUTHORIZED',
        message: `daemon rejected the call (${response.status}${typeof serverCode === 'string' ? ` ${serverCode}` : ''}) — this is an identity/authorization problem, not a missing service`,
        ok: false,
      },
      status: response.status,
    }
  }

  if (response.status === 404) {
    return {
      body,
      failure: { code: 'SERVICE_ABSENT', message: `${SERVICE} is not implemented on this daemon (404 for ${method})`, ok: false },
      status: 404,
    }
  }

  if (response.status === 501) {
    // 501 是實作者的明示：「這個方法我還沒做」。讀成 BAD_RESPONSE 會讓人以為回應壞了；
    // 讀成 SERVICE_ABSENT 會讓人以為整個能力沒上線——兩者都會把人送去錯的地方修。
    const serverCode = (body?.error as { code?: unknown } | undefined)?.code
    const serverMessage = (body?.error as { message?: unknown } | undefined)?.message
    return {
      body,
      failure: {
        code: 'NOT_IMPLEMENTED',
        message:
          `${SERVICE}/${method} is not implemented yet (501${typeof serverCode === 'string' ? ` ${serverCode}` : ''})` +
          `${typeof serverMessage === 'string' ? `: ${serverMessage}` : ''}`,
        ok: false,
      },
      status: 501,
    }
  }

  if (!response.ok) {
    // 把伺服器說的原因帶出來。原本只寫 `answered 400`——那句話讓「我送錯欄位」和
    // 「伺服器吐了垃圾」長得一模一樣，而 400 幾乎總是在說前者（例如送 `ids` 而不是
    // `docIds`：`INVALID_ENVELOPE: 要刪什麼？`）。
    const errorBody = (body?.error as { code?: unknown; message?: unknown } | undefined) ?? undefined
    const serverCode = typeof errorBody?.code === 'string' ? errorBody.code : ''
    const serverMessage = typeof errorBody?.message === 'string' ? errorBody.message : ''
    return {
      body,
      failure: {
        code: 'BAD_RESPONSE',
        message: `${SERVICE}/${method} answered ${response.status}${serverCode === '' ? '' : ` ${serverCode}`}${serverMessage === '' ? '' : `: ${serverMessage}`}`,
        ok: false,
      },
      status: response.status,
    }
  }

  return { body, status: response.status }
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const asNumber = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** 探測服務是否可用、契約版本是否符合。呼叫方啟動時該先問這一個。 */
export async function probeIndex(env: CapIndexEnv, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<
  { available: true; info: IndexInfo } | { available: false; code: FailureCode; message: string; detail?: Record<string, unknown> }
> {
  const outcome = await call(env, 'Info', {}, timeoutMs)
  if (outcome.failure !== undefined) {
    const { code, message, detail } = outcome.failure
    return { available: false, code, message, ...(detail === undefined ? {} : { detail }) }
  }

  const body = asRecord(outcome.body)
  const contractVersion = asNumber(body.contractVersion, -1)
  if (contractVersion < MIN_CONTRACT_VERSION) {
    // 舊服務端：可能缺我們依賴的欄位，不猜、不降級。兩個版本號都要講出來。
    return {
      available: false,
      code: 'CONTRACT_MISMATCH',
      detail: { client: MIN_CONTRACT_VERSION, server: contractVersion },
      message: `contract too old: this client needs v${MIN_CONTRACT_VERSION}+, the daemon implements v${contractVersion}`,
    }
  }

  return {
    available: true,
    info: {
      capabilities: asArray(body.capabilities).filter((c): c is string => typeof c === 'string'),
      chunker: asString(body.chunker),
      contractVersion,
      defaultLimit: asNumber(body.defaultLimit),
      indexVersion: asNumber(body.indexVersion),
      maxDocumentsPerIngest: asNumber(body.maxDocumentsPerIngest),
      maxLimit: asNumber(body.maxLimit),
      maxTextBytesPerDocument: asNumber(body.maxTextBytesPerDocument),
      ...(body.semantics !== undefined && body.semantics !== null ? { semantics: asRecord(body.semantics) } : {}),
      service: asString(body.service),
      version: asString(body.version),
    },
  }
}

/**
 * 寫入或更新一批文件。
 * 空 namespace 在**本地**就拒絕：讓它變成伺服器端的錯誤，等於把呼叫方的 bug 記成基礎設施故障。
 */
export async function ingestDocuments(
  env: CapIndexEnv,
  namespace: string,
  documents: IndexDocument[],
  opts: { atomic?: boolean; timeoutMs?: number } = {},
): Promise<IngestOutcome | Failure> {
  if (namespace.trim() === '') {
    return { code: 'INVALID_REQUEST', message: 'namespace must be non-empty: a default namespace silently mixes two unrelated corpora', ok: false }
  }
  if (documents.length === 0) {
    return { code: 'INVALID_REQUEST', message: 'ingest needs at least one document', ok: false }
  }

  const outcome = await call(env, 'Ingest', { atomic: opts.atomic ?? false, documents, namespace }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (outcome.failure !== undefined) return outcome.failure

  const body = asRecord(outcome.body)
  const documentsOut = asArray(body.documents).map((raw): DocumentOutcome => {
    const doc = asRecord(raw)
    const status = asString(doc.status, 'UNKNOWN')
    return {
      chunks: asNumber(doc.chunks),
      error: asString(doc.error),
      id: asString(doc.id),
      status: (['INDEXED', 'UNCHANGED', 'FAILED', 'REJECTED'] as const).includes(status as never) ? (status as DocumentStatus) : 'UNKNOWN',
      textBytes: asNumber(doc.textBytes),
    }
  })

  return {
    documents: documentsOut,
    failed: asNumber(body.failed),
    indexVersion: asNumber(body.indexVersion),
    indexed: asNumber(body.indexed),
    ok: true,
    rejected: asNumber(body.rejected),
    unchanged: asNumber(body.unchanged),
  }
}

/** 檢索。回傳的 `state` 就是 B 條不變量的落地：三種情況呼叫方不必自己判斷。 */
export async function searchIndex(
  env: CapIndexEnv,
  namespace: string,
  query: string,
  opts: {
    limit?: number
    snippetChars?: number
    syntax?: 'PLAIN' | 'TERMS'
    /** `doc` ＝ 回文件級排序（一個 docId 一條）。預設 `chunk`。 */
    groupBy?: 'chunk' | 'doc'
    /** 只在 `groupBy:"doc"` 有意義：`max` / `sum` / `mean`。
     *
     *  **不要在客戶端假設伺服器預設值。** 回應會回顯這次實際生效的 `docAggregation`，
     *  以回顯為準（2026-11-01 的實驗裡這三種在 11 題上有 6/4/1 的勝場分布，
     *  `mean` 對 `max` 顯著較好，但 `mean` 與 `sum` 分不開——它們量的是不同的問題）。 */
    docAggregation?: 'max' | 'sum' | 'mean'
    timeoutMs?: number
  } = {},
): Promise<SearchOutcome | Failure> {
  if (namespace.trim() === '') {
    return { code: 'INVALID_REQUEST', message: 'namespace must be non-empty', ok: false }
  }
  // `docAggregation` 只在 doc 模式下有意義（伺服器對 chunk 模式帶它會回 400「沒有作用的欄位是謊」）。
  // 呼叫方自己能擋得更早：連請求都不發，也就不用去解讀那個 400 到底是什麼意思。
  if (opts.docAggregation !== undefined && opts.groupBy !== 'doc') {
    return {
      code: 'INVALID_REQUEST',
      message: 'docAggregation only means something with groupBy:"doc": pass both, or neither',
      ok: false,
    }
  }

  const payload: Record<string, unknown> = { namespace, query, snippet_chars: opts.snippetChars ?? 200 }
  if (opts.limit !== undefined) payload.limit = opts.limit
  if (opts.syntax !== undefined) payload.syntax = opts.syntax === 'TERMS' ? 'SYNTAX_TERMS' : 'SYNTAX_PLAIN'
  if (opts.groupBy !== undefined) payload.groupBy = opts.groupBy
  if (opts.docAggregation !== undefined) payload.docAggregation = opts.docAggregation

  const outcome = await call(env, 'Search', payload, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (outcome.failure !== undefined) return outcome.failure

  const body = asRecord(outcome.body)
  const hits = asArray(body.hits).map((raw): IndexHit => {
    const hit = asRecord(raw)
    return {
      // doc 模式沒有這個欄位。缺席就真的不要放一個 0 進去——那個 0 會被讀成「第 0 塊」。
      ...(hit.chunkOrdinal === undefined ? {} : { chunkOrdinal: asNumber(hit.chunkOrdinal) }),
      docId: asString(hit.docId),
      kind: asString(hit.kind),
      labels: Object.fromEntries(Object.entries(asRecord(hit.labels)).map(([k, v]) => [k, String(v)])),
      score: asNumber(hit.score),
      snippet: asString(hit.snippet),
      snippetTruncated: hit.snippetTruncated === true,
      ...(hit.bestChunkOrdinal === undefined ? {} : { bestChunkOrdinal: asNumber(hit.bestChunkOrdinal) }),
      ...(hit.bestChunkScore === undefined ? {} : { bestChunkScore: asNumber(hit.bestChunkScore) }),
      ...(hit.chunkCount === undefined ? {} : { chunkCount: asNumber(hit.chunkCount) }),
      ...(hit.matchedChunkCount === undefined ? {} : { matchedChunkCount: asNumber(hit.matchedChunkCount) }),
    }
  })

  const matchedDocuments = asNumber(body.matchedDocuments)
  const namespaceDocuments = asNumber(body.namespaceDocuments)
  // B 的落地點。分不出這兩者，使用者會一直換關鍵字而資料根本沒進去。
  const state: SearchState = hits.length > 0 ? 'hits' : namespaceDocuments === 0 ? 'not-indexed' : 'no-hits'

  return {
    candidatesTruncated: body.candidatesTruncated === true,
    chunker: asString(body.chunker),
    durationMs: asNumber(body.durationMs),
    groupBy: asString(body.groupBy) || 'chunk',
    // 只有伺服器真的回了才放進來：缺席 ≠ 預設值。假設它是 max 就是把語意塞進客戶端。
    ...(asString(body.docAggregation) === '' ? {} : { docAggregation: asString(body.docAggregation) }),
    hits,
    indexVersion: asNumber(body.indexVersion),
    // 伺服器回報的那幾個「我實際用了什麼」，照抄不重算：
    // 要求 500 卻只回 100 筆時，呼叫方要能看出是夾鉗，而不是以為資料只有 100 筆。
    limit: asNumber(body.limit),
    matchedDocuments,
    namespaceDocuments,
    normalizedQuery: asString(body.normalizedQuery),
    ok: true,
    order: asString(body.order),
    returned: asNumber(body.returned) || hits.length,
    staleDocuments: asNumber(body.staleDocuments),
    state,
  }
}

/** 命名空間現況。搜尋前先用它回答「這裡到底有沒有東西」。 */
export async function indexStats(env: CapIndexEnv, namespace = '', timeoutMs = DEFAULT_TIMEOUT_MS): Promise<StatsOutcome | Failure> {
  const outcome = await call(env, 'Stats', { namespace }, timeoutMs)
  if (outcome.failure !== undefined) return outcome.failure

  const body = asRecord(outcome.body)
  return {
    namespaces: asArray(body.namespaces).map((raw) => {
      const ns = asRecord(raw)
      return {
        chunks: asNumber(ns.chunks),
        documents: asNumber(ns.documents),
        indexVersion: asNumber(ns.indexVersion),
        lastIngestUnixMs: asNumber(ns.lastIngestUnixMs),
        namespace: asString(ns.namespace),
        textBytes: asNumber(ns.textBytes),
      }
    }),
    ok: true,
    storeBytes: asNumber(body.storeBytes),
  }
}

export interface DeleteOutcome {
  deletedChunks: number
  deletedDocuments: number
  /** `dryRun: true` 時伺服器只回報會刪多少，不動資料。 */
  dryRun: boolean
  /** 「刪了幾個」和「還剩什麼」是兩個問題，契約兩個都回。 */
  indexVersion: number
  namespace: string
  ok: true
  remainingChunks: number
  remainingDocuments: number
}

/**
 * 刪除文件。
 *
 * 欄位名以**活體量測**為準，不以文件為準（2026-11-01，GAS 的 daemon）：
 *   `{namespace, docIds: [...]}` 或 `{namespace, all: true}` → 200
 *   `{namespace, ids: [...]}`                 → 400 INVALID_ENVELOPE（「要刪什麼？」）
 *   `{namespace}`（什麼目標都不給）            → 400 INVALID_ENVELOPE
 *
 * 所以這裡用 **`docIds` / `all`**，與線上完全同名——不再有 `ids`/`purgeNamespace`
 * 這種只存在於客戶端的別名。一個欄位兩個名字，下一個人就會送錯，然後拿到一個
 * 看起來像「沒有東西可刪」的回應。
 *
 * `docIds` 與 `all` 同時給是矛盾輸入：契約要求服務端拒絕，但呼叫方自己能擋得更早
 * ——連請求都不發。
 */
export async function deleteDocuments(
  env: CapIndexEnv,
  namespace: string,
  opts: { docIds?: string[]; all?: boolean; dryRun?: boolean; timeoutMs?: number } = {},
): Promise<DeleteOutcome | Failure> {
  if (namespace.trim() === '') {
    return { code: 'INVALID_REQUEST', message: 'namespace must be non-empty', ok: false }
  }
  const docIds = opts.docIds ?? []
  if (docIds.length > 0 && opts.all === true) {
    return { code: 'INVALID_REQUEST', message: 'docIds and all are contradictory: choose one, do not rely on the server picking', ok: false }
  }
  if (docIds.length === 0 && opts.all !== true) {
    return { code: 'INVALID_REQUEST', message: 'delete needs either docIds or all=true — "no target given" is not "delete everything"', ok: false }
  }

  const payload: Record<string, unknown> = { namespace }
  if (docIds.length > 0) {
    payload.docIds = docIds
  } else {
    payload.all = true
  }
  if (opts.dryRun === true) payload.dryRun = true

  const outcome = await call(env, 'Delete', payload, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (outcome.failure !== undefined) return outcome.failure

  const body = asRecord(outcome.body)
  return {
    deletedChunks: asNumber(body.deletedChunks),
    deletedDocuments: asNumber(body.deletedDocuments),
    dryRun: body.dryRun === true,
    indexVersion: asNumber(body.indexVersion),
    namespace: asString(body.namespace) || namespace,
    ok: true,
    remainingChunks: asNumber(body.remainingChunks),
    remainingDocuments: asNumber(body.remainingDocuments),
  }
}

/** 給人看的一行摘要。刻意把三種失敗寫成不同句子，而不是同一個 "failed"。 */
export function describeAvailability(
  probe: { available: true; info: IndexInfo } | { available: false; code: FailureCode; message: string },
): string {
  if (probe.available) {
    return `${probe.info.service} v${probe.info.version} · contract v${probe.info.contractVersion} · chunker ${probe.info.chunker || '(unreported)'} · index v${probe.info.indexVersion}`
  }
  switch (probe.code) {
    case 'SERVICE_ABSENT':
      return '這台 daemon 還沒有 Index 服務（路由不存在）——找實作者，不要換關鍵字或重試'
    case 'UNAUTHORIZED':
      return 'Index 存在但拒絕這次呼叫（身分/授權）——檢查總線 token，不是服務不存在'
    case 'CONTRACT_MISMATCH':
      return `契約版本太舊（客戶端需要 v${MIN_CONTRACT_VERSION}+）——拒絕執行，不降級`
    case 'UNAVAILABLE':
      return '連不上 daemon（沒跑、port 檔不見、逾時）——先確認 bus 活著'
    case 'NOT_IMPLEMENTED':
      return '服務在，但這個方法還沒實作（實作方回 501）——照它的排程等，不要當成壞掉'
    case 'INVALID_REQUEST':
      return '請求本身不合法——修呼叫方，不要重試'
    default:
      return '服務回應了但不是預期的形狀——先看原始回應'
  }
}
