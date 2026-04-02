/**
 * Context management pipeline — barrel export.
 *
 * ChunkManager  → splits history into overlapping word-chunks
 * BM25Retriever → keyword-based retrieval (pure TS, ~80 lines)
 * SummaryManager → on-demand compression via Ollama
 * ContextBuilder → assembles the final prompt for the model
 */

export { ChunkManager } from "./chunk-manager";
export type { Chunk } from "./chunk-manager";
export { BM25Retriever } from "./bm25-retriever";
export type { BM25Index } from "./bm25-retriever";
export { SummaryManager } from "./summary-manager";
export { ContextBuilder } from "./context-builder";
export type { AssembledContext } from "./context-builder";
export { ClusterMemoryService } from "./cluster-memory";
export type { ClusterMemorySnapshot, ClusterAnomalies } from "./cluster-memory";
export { MEMORY_STALE_MS } from "./cluster-memory";
