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
export declare const MIN_CONTRACT_VERSION = 1;
/** @deprecated 舊名，保留以免呼叫方斷裂；語意已從「必須相等」改為「最低版本」。 */
export declare const EXPECTED_CONTRACT_VERSION = 1;
export interface CapIndexEnv {
    baseUrl: string;
    token: string;
    /** 從哪裡解析出來的，供診斷顯示；不要用它做分支。 */
    source: string;
}
/** 解析 daemon 位址與 token。每次呼叫都重讀 port/token：它們會被重新配發。 */
export declare function resolveEnv(opts?: {
    dshHome?: string;
    baseUrl?: string;
    timeoutMs?: number;
}): CapIndexEnv;
export type FailureCode = 
/** 這個 daemon 根本沒有 Index 服務（路由不存在）——不是錯誤，是「還沒實作」。 */
'SERVICE_ABSENT'
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
 | 'INVALID_REQUEST';
export interface Failure {
    ok: false;
    code: FailureCode;
    message: string;
    detail?: Record<string, unknown>;
}
export declare const isFailure: (value: unknown) => value is Failure;
export interface IndexInfo {
    capabilities: string[];
    chunker: string;
    contractVersion: number;
    defaultLimit: number;
    indexVersion: number;
    maxDocumentsPerIngest: number;
    maxLimit: number;
    maxTextBytesPerDocument: number;
    /**
     * 伺服器自己對「這些數字什麼意思」的說明（`Info.semantics`）：`limit` 的預設與上限、
     * 排序規則、`groupBy` 的兩種模式、`matchedDocuments` 與 `namespaceDocuments` 的差別……
     *
     * 為什麼要原樣帶過來：**語意必須住在契約看得見的地方，不能只住實作方的 README**。
     * 客戶端不讀 README 也能正確翻頁——這正是 GAS 的 V3 要解決的事，這裡只是不再把它丟掉。
     */
    semantics?: Record<string, unknown>;
    service: string;
    version: string;
    /**
     * 原始 `Info` 回應，原樣保留。
     *
     * 為什麼需要：上面那些欄位是**白名單**。伺服器新增的欄位會被這個解析器靜默丟掉，
     * 於是「對方加了能力」在客戶端看起來跟「對方沒加」一模一樣。
     *
     * 2026-11-02 實測：GAS 在 `Info` 加了 `compat` / `where` / `truthStatus`，
     * 其中 `where` 就是**為了讓客戶端不必硬寫路徑**而存在的索引——而我的檢查一路讀到
     * `undefined`，差點回報「你沒部署」。真相是：欄位在，是我把它丟了。
     *
     * 白名單本身沒有錯（型別穩定、呼叫方好寫），錯的是**只**給白名單。
     * 合約的版本是**下界**，客戶端永遠會有它不認識的欄位；留一份原樣，新能力才有可能被發現。
     */
    raw: Record<string, unknown>;
}
export interface IndexDocument {
    id: string;
    text: string;
    contentSha256: string;
    kind?: string;
    labels?: Record<string, string>;
    textBytes?: number;
}
/**
 * 逐份狀態。**這是契約的核心**：`UNCHANGED` 與 `FAILED` 必須分得開。
 * 把它們併成一個 `ok`，報表數字就會對不上，而那是我們已經付過代價的失敗。
 */
export type DocumentStatus = 'INDEXED' | 'UNCHANGED' | 'FAILED' | 'REJECTED' | 'UNKNOWN';
export interface DocumentOutcome {
    id: string;
    status: DocumentStatus;
    chunks: number;
    error: string;
    textBytes: number;
}
export interface IngestOutcome {
    ok: true;
    documents: DocumentOutcome[];
    failed: number;
    indexed: number;
    indexVersion: number;
    rejected: number;
    unchanged: number;
}
export interface IndexHit {
    /** chunk 模式才有；doc 模式（`groupBy`）回的是文件級條目，這個欄位不存在。 */
    chunkOrdinal?: number;
    docId: string;
    kind: string;
    labels: Record<string, string>;
    score: number;
    snippet: string;
    snippetTruncated: boolean;
    /** 最高分區塊在該文件中的序號。 */
    bestChunkOrdinal?: number;
    /** 最高單一區塊分數。`score` 只在 `docAggregation:"max"` 時等於它；
     *  `"sum"` 與 `"mean"` 下都不是（sum 是所有命中塊之和、mean 是它們的均值）。 */
    bestChunkScore?: number;
    /** 這份文件被切成幾塊（長度偏誤的來源，呼叫方要自己看）。 */
    chunkCount?: number;
    /** 這次查詢命中幾塊。`score/sum` 用得到它，`score/max` 用不到。 */
    matchedChunkCount?: number;
}
/**
 * 檢索結果一定帶 `state`。呼叫方不該自己去比對兩個計數——
 * 「索引過但 0 命中」與「這裡根本還沒索引」的處置完全不同，
 * 而混為一談正是使用者會換三次關鍵字的來源。
 */
export type SearchState = 'hits' | 'no-hits' | 'not-indexed';
export interface SearchOutcome {
    ok: true;
    /** `true` ＝候選命中上限，結果可能不完整——不是「只有這些」（契約原文）。 */
    candidatesTruncated: boolean;
    chunker: string;
    durationMs: number;
    /** 這次實際用的分組方式（`chunk` 或 `doc`）——由伺服器回報，不是客戶端假設。 */
    groupBy: string;
    /**
     * doc 模式下伺服器實際用的聚合方式（`max` / `sum`）。伺服器回什麼就轉什麼，
     * 客戶端**不解釋** `score`——同一個數字在兩種聚合下意思不同，解釋權在伺服器的 `semantics`。
     */
    docAggregation?: string;
    hits: IndexHit[];
    indexVersion: number;
    /** **伺服器實際採用的 limit**。要求 500 而得到 100 時，這裡是 100（契約夾鉗，不是靜默改寫）。 */
    limit: number;
    matchedDocuments: number;
    namespaceDocuments: number;
    normalizedQuery: string;
    /** 這次實際用的排序方向。語意住在伺服器的 `Info.semantics`，客戶端只轉述。 */
    order: string;
    /** 這次回了幾筆（`hits.length` 的伺服器版本，用來對照 limit）。 */
    returned: number;
    staleDocuments: number;
    state: SearchState;
}
export interface StatsOutcome {
    ok: true;
    namespaces: {
        chunks: number;
        documents: number;
        indexVersion: number;
        lastIngestUnixMs: number;
        namespace: string;
        textBytes: number;
    }[];
    storeBytes: number;
}
/** 探測服務是否可用、契約版本是否符合。呼叫方啟動時該先問這一個。 */
export declare function probeIndex(env: CapIndexEnv, timeoutMs?: number): Promise<{
    available: true;
    info: IndexInfo;
} | {
    available: false;
    code: FailureCode;
    message: string;
    detail?: Record<string, unknown>;
}>;
/**
 * 寫入或更新一批文件。
 * 空 namespace 在**本地**就拒絕：讓它變成伺服器端的錯誤，等於把呼叫方的 bug 記成基礎設施故障。
 */
export declare function ingestDocuments(env: CapIndexEnv, namespace: string, documents: IndexDocument[], opts?: {
    atomic?: boolean;
    timeoutMs?: number;
}): Promise<IngestOutcome | Failure>;
/** 檢索。回傳的 `state` 就是 B 條不變量的落地：三種情況呼叫方不必自己判斷。 */
export declare function searchIndex(env: CapIndexEnv, namespace: string, query: string, opts?: {
    limit?: number;
    snippetChars?: number;
    syntax?: 'PLAIN' | 'TERMS';
    /** `doc` ＝ 回文件級排序（一個 docId 一條）。預設 `chunk`。 */
    groupBy?: 'chunk' | 'doc';
    /** 只在 `groupBy:"doc"` 有意義：`max` / `sum` / `mean`。
     *
     *  **不要在客戶端假設伺服器預設值。** 回應會回顯這次實際生效的 `docAggregation`，
     *  以回顯為準（2026-11-01 的實驗裡這三種在 11 題上有 6/4/1 的勝場分布，
     *  `mean` 對 `max` 顯著較好，但 `mean` 與 `sum` 分不開——它們量的是不同的問題）。 */
    docAggregation?: 'max' | 'sum' | 'mean';
    timeoutMs?: number;
}): Promise<SearchOutcome | Failure>;
/** 命名空間現況。搜尋前先用它回答「這裡到底有沒有東西」。 */
export declare function indexStats(env: CapIndexEnv, namespace?: string, timeoutMs?: number): Promise<StatsOutcome | Failure>;
export interface DeleteOutcome {
    deletedChunks: number;
    deletedDocuments: number;
    /** `dryRun: true` 時伺服器只回報會刪多少，不動資料。 */
    dryRun: boolean;
    /** 「刪了幾個」和「還剩什麼」是兩個問題，契約兩個都回。 */
    indexVersion: number;
    namespace: string;
    ok: true;
    remainingChunks: number;
    remainingDocuments: number;
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
export declare function deleteDocuments(env: CapIndexEnv, namespace: string, opts?: {
    docIds?: string[];
    all?: boolean;
    dryRun?: boolean;
    timeoutMs?: number;
}): Promise<DeleteOutcome | Failure>;
/** 給人看的一行摘要。刻意把三種失敗寫成不同句子，而不是同一個 "failed"。 */
export declare function describeAvailability(probe: {
    available: true;
    info: IndexInfo;
} | {
    available: false;
    code: FailureCode;
    message: string;
}): string;
