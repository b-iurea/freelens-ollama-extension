/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface OllamaConfig {
  endpoint: string;
  model: string;
}

export interface ClusterContext {
  clusterName: string;
  namespace: string;
  namespaces: string[];
  pods: K8sResourceSummary[];
  deployments: K8sResourceSummary[];
  services: K8sResourceSummary[];
  nodes: K8sResourceSummary[];
  events: K8sEventSummary[];
  /** Unix ms timestamp of when gatherContext() completed this API fetch. */
  gatheredAt?: number;
  /**
   * When ClusterMemoryService filters context for relevance, these carry
   * the unfiltered totals so buildSystemPrompt can show "(N of M, relevant to query)".
   */
  totalPods?: number;
  totalDeployments?: number;
  totalServices?: number;
  totalEvents?: number;
  /** ISO timestamp of when this snapshot was originally saved to memory. */
  snapshotAge?: number;
  /**
   * Cluster-wide health aggregate computed at snapshot time.
   * Allows buildSystemPrompt to show a one-line summary like
   * "170 Running · 7 Pending · 3 CrashLoopBackOff" without listing every pod.
   */
  podStatusCounts?: Record<string, number>;
  deploymentHealthSummary?: { healthy: number; degraded: number };
  /**
   * Per-namespace health rollup computed at snapshot time.
   * Gives the model a global view of the cluster (which namespaces have issues)
   * at near-zero token cost (~10 tokens/namespace).
   */
  namespaceHealth?: Record<string, NamespaceHealthSummary>;
}

/** Health aggregate for a single namespace. */
export interface NamespaceHealthSummary {
  podStatusCounts: Record<string, number>;
  totalPods: number;
  totalDeployments: number;
  degradedDeployments: number;
  warningEvents: number;
}

/** Runtime detail for a single container inside a pod (populated only for non-Running pods). */
export interface ContainerSummary {
  name: string;
  /** Kubernetes state/reason string, e.g. "Running", "CrashLoopBackOff", "OOMKilled". */
  state: string;
  reason?: string;
  exitCode?: number;
  restarts?: number;
  /** True when the container is NOT in the sidecar blacklist. */
  isMain: boolean;
  isSidecar: boolean;
}

export interface K8sResourceSummary {
  name: string;
  namespace?: string;
  status?: string;
  age?: string;
  labels?: Record<string, string>;
  replicas?: string;
  ready?: string;
  /** Populated only for pods in a non-Running/non-healthy state. */
  containers?: ContainerSummary[];
}

export interface K8sEventSummary {
  type: string;
  reason: string;
  message: string;
  involvedObject: string;
  age?: string;
  /** Namespace of the involved object — used for per-namespace warning counts. */
  namespace?: string;
  /** Set when events are grouped by reason: how many occurrences were merged. */
  count?: number;
  /** Human-readable relative time of the most recent occurrence, e.g. "3m". */
  lastSeen?: string;
}

/** One-line health summary for a single namespace — used in all-namespaces view. */
export interface NamespaceDigest {
  name: string;
  /** Pod status → count map, e.g. { Running: 10, CrashLoopBackOff: 2 }. */
  podCounts: Record<string, number>;
  totalPods: number;
  totalDeployments: number;
  degradedDeployments: number;
  totalServices: number;
  /** Warning event count for this namespace. */
  warningCount: number;
}

/**
 * Compressed cluster context passed directly to buildSystemPrompt.
 * Produced by compressForPrompt() — two layouts depending on viewMode.
 */
export interface CompressedClusterContext {
  viewMode: "all-namespaces" | "single-namespace";
  clusterName: string;
  /** Unix ms from the source ClusterContext.gatheredAt — rendered in system prompt header. */
  gatheredAt?: number;
  /** Always full list — cluster-scoped resource. */
  nodes: K8sResourceSummary[];
  /** Warning events aggregated by (reason + object), max 20 groups. */
  groupedWarnings: K8sEventSummary[];
  // ── all-namespaces fields ──
  namespaceDigests?: NamespaceDigest[];
  anomalyPods?: K8sResourceSummary[];
  anomalyDeployments?: K8sResourceSummary[];
  totalPods?: number;
  totalDeployments?: number;
  totalServices?: number;
  // ── single-namespace fields ──
  namespace?: string;
  pods?: K8sResourceSummary[];
  deployments?: K8sResourceSummary[];
  services?: K8sResourceSummary[];
}

export interface OllamaModelParams {
  temperature: number;
  top_p: number;
  top_k: number;
  num_predict: number;
  repeat_penalty: number;
}

/* ─── Fidelity Evaluation ─────────────────────────────────────────────────── */

/** A single difference spotted by the judge between Diagnosis A and Diagnosis B. */
export interface FidelityDiscrepancy {
  /** "missing_info" | "hallucinated_resource" | "wrong_severity" | "extra_context" */
  type: string;
  description: string;
}

/** Full evaluation report returned by runFidelityEvaluation(). */
export interface FidelityReport {
  /** 0–1 composite score (1 = perfectly faithful, 0 = completely different). */
  score: number;
  /**
   * Raw 1-5 judge score from the LLM judge, converted to 0-1.
   * null when the judge call failed.
   */
  judgeScore: number | null;
  /**
   * Fraction of characters saved: 1 - (compressed.length / raw.length).
   * Positive = compressed is smaller.
   */
  compressionRatio: number;
  /** Approximate token savings based on character count (chars / 4). */
  tokenSavings: number;
  /** Latency of the raw-data call in ms. */
  rawLatencyMs: number;
  /** Latency of the compressed-data call in ms. */
  compressedLatencyMs: number;
  /** Positive = compressed was faster. */
  latencyDifferenceMs: number;
  /** Resource names mentioned in Diagnosis B that are NOT present in the raw data. */
  hallucinatedResources: string[];
  /** Structured differences extracted from the judge response. */
  discrepancies: FidelityDiscrepancy[];
  /** Full text of Diagnosis A (raw data). */
  diagnosisA: string;
  /** Full text of Diagnosis B (compressed data). */
  diagnosisB: string;
  /** The judge's raw explanation text. */
  judgeExplanation: string;
  /** ISO timestamp of when the evaluation was run. */
  evaluatedAt: string;
  /** Model used for all three calls. */
  model: string;
}

export const DEFAULT_MODEL_PARAMS: OllamaModelParams = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  num_predict: -1,
  repeat_penalty: 1.1,
};

export interface OllamaChatRequest {
  model: string;
  messages: ApiMessage[];
  stream: boolean;
  tools?: OllamaTool[];
  options?: Partial<OllamaModelParams>;
}

export interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export interface OllamaStreamChunk {
  model: string;
  message: {
    role: string;
    content: string;
    /** Present when the model wants to call one or more tools instead of producing text. */
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  /* ── Performance fields (only present when done=true) ── */
  total_duration?: number;       // nanoseconds
  load_duration?: number;        // nanoseconds
  prompt_eval_count?: number;    // tokens evaluated in the prompt
  prompt_eval_duration?: number; // nanoseconds
  eval_count?: number;           // tokens generated
  eval_duration?: number;        // nanoseconds
}

/** Parsed performance stats from Ollama's final streaming chunk. */
export interface OllamaPerformanceStats {
  model: string;
  totalDurationMs: number;
  promptTokens: number;
  promptEvalMs: number;
  promptTokensPerSec: number;
  generatedTokens: number;
  generationMs: number;
  tokensPerSec: number;
  loadMs: number;
  timestamp: number;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

/**
 * A single message in the Ollama chat API.
 * role can be "system" | "user" | "assistant" | "tool".
 * tool_calls is present on assistant messages that invoke tools.
 */
export interface ApiMessage {
  role: string;
  content: string;
  tool_calls?: OllamaToolCall[];
}

/** A single tool-call request produced by the model. */
export interface OllamaToolCall {
  function: {
    name: string;
    /** JSON-decoded arguments from the model. */
    arguments: Record<string, any>;
  };
}

/** Ollama tool-calling schema (OpenAI-compatible format). */
export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      required?: string[];
      properties: Record<string, {
        type: "string" | "number" | "boolean";
        description: string;
        enum?: string[];
      }>;
    };
  };
}

/* ── Context pipeline types (used by ChunkManager / BM25 / SummaryManager) ── */

export interface ConversationState {
  /** Current summary of old turns (empty string if none) */
  summary: string;
  /** Index up to which messages have been summarised */
  summarisedUpToIndex: number;
  /** Whether a summary is currently being generated */
  isSummarising: boolean;
}
