/**
 * dsh-research-lab — ACP graph compatibility layer.
 *
 * dsh-session-handoff 的 acp_graph (~/.dsh/graph/graph.db) 是跨会话长期记忆的
 * 权威图。rlab_related 检索项目文档时，可选融合 ACP 图的跨会话 checkpoint
 * 命中——把"以前会话里关于这个主题的决定/上下文"带进当前研究项目。
 *
 * 依赖方式：通过【规范化只读契约】读取 ACP 图（见 src/acp-graph-contract.ts，
 * 由 dsh-acp-graph-contract 同步而来，顶部带源哈希，漂移会被 --check 抓到），
 * 不再裸 SQLite + 硬编码表名 + "失败即返回 []"。
 * 无 ACP 图时返回 []，完全降级为纯项目内检索（不破坏现有功能）。
 *
 * 为什么改成契约（历史教训）
 * --------------------------
 * 旧实现直接 `new DatabaseSync(acpGraphPath())` 并拼表名，"失败即返回 []"。
 * 于是三种完全不同的状况在调用方看来一模一样：
 *   - 本来就没数据（正常）
 *   - 库不存在 / 插件没装（正常降级）
 *   - schema 变了 / 库被锁 / 库比消费方新（故障——但静默返回 []）
 * 契约返回具名的 Result，因此"没有数据"与"读取失败"不再混淆；失败原因经
 * acpGraphDiagnostics() / acpGraphStatusLine() 暴露。
 *
 * 【可用性语义】acpGraphAvailable() 现在判的是"契约可读"（库存在 + 版本戳不高于
 * 本读取器 + v1 形状齐全），而不再是"checkpoints 表非空"。
 *
 * 边界：只读。图的结构与数据只能由生产者(handoff)变更。
 */
import { ftsPhrase as contractFtsPhrase, type AcpGraphStatus, type AcpRecallHit } from './acp-graph-contract.js';
export type { AcpGraphStatus, AcpRecallHit };
/** graph.db 的规范路径由契约拥有。 */
export { acpGraphPath } from './acp-graph-contract.js';
/** FTS5 phrase builder（规范化实现；原先 4 个插件各自逐字复制了一份）。 */
export declare const ftsPhrase: typeof contractFtsPhrase;
/** 诊断用：契约状态 + 最近一次失败原因。 */
export declare function acpGraphDiagnostics(): {
    status: AcpGraphStatus;
    lastProblem: {
        detail: string;
        status: AcpGraphStatus;
    } | null;
};
/**
 * 一行人类可读的状态，用于工具输出。
 * 刻意区分"没装"与"装了但读不了"——旧文案在图不可用时一律说
 * "(acp graph not available — install dsh-session-handoff)"，
 * 即使插件已装、只是 schema 不匹配，也会把人引向错误的方向。
 */
export declare function acpGraphStatusLine(): string;
/**
 * 图是否【可读】。语义变更有意为之：旧实现判的是"checkpoints 表非空"，于是
 * "库健康但没有 checkpoint"会被报成"不可用"。现在判契约是否可读，与数据量无关。
 * 调用方若需要"有内容"，请看查询结果本身，而不是本函数。
 */
export declare function acpGraphAvailable(): boolean;
/** 查询 ACP 图，返回跨会话 checkpoint 命中（FTS5 实体 + 摘要）。失败返回 [] 并记录原因。 */
export declare function acpGraphRecall(query: string, limit?: number): AcpRecallHit[];
