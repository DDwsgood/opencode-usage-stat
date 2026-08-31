/**
 * stats-store.ts — 持久化聚合统计存储
 *
 * 设计目标：将性能指标的"聚合统计"与"原始 JSONL 日志"彻底解耦。
 * - 每次请求完成时，通过 updatePersistedStats() 增量写入 JSON 统计文件
 * - 统计文件永久累积，不受 JSONL 日志轮转/窗口限制影响
 * - 百分位数采用 Reservoir Sampling 保持有界内存占用
 * - 首次启动时从同版本 JSONL 日志重建；旧口径性能样本不会混入
 */
import type { LogEntry, ModelPerfStats } from "./formatter.js";
export declare function setUsageStatStorePaths(stats: string, log: string): void;
/**
 * 将一条新的日志条目增量更新到持久化统计文件。
 * 在 perf-tracker.ts 的 appendLog() 之后调用。
 *
 * 设计原则：本函数只做增量更新，迁移逻辑由 readPersistedStats() 负责。
 * 这样可以避免迁移与增量更新之间的竞态问题。
 */
export declare function updatePersistedStats(entry: LogEntry): void;
/**
 * 读取所有持久化统计，返回 ModelPerfStats 数组（含分位数）。
 * 用于 HTML 报告生成，替代 aggregatePerfStats(readLogs(N)) 的有限窗口方案。
 */
export declare function readPersistedStats(): ModelPerfStats[];
