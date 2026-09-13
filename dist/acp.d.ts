export declare function acpGraphAvailable(): boolean;
export interface AcpRecallHit {
    node: string;
    summary: string;
    score: number;
}
/** 查询 ACP 图，返回跨会话 checkpoint 命中（FTS5 实体 + 摘要）。 */
export declare function acpGraphRecall(query: string, limit?: number): AcpRecallHit[];
