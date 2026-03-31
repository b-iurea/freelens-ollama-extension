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
  pods: K8sResourceSummary[];
  deployments: K8sResourceSummary[];
  services: K8sResourceSummary[];
  nodes: K8sResourceSummary[];
  events: K8sEventSummary[];
}

export interface K8sResourceSummary {
  name: string;
  namespace?: string;
  status?: string;
  age?: string;
  labels?: Record<string, string>;
  replicas?: string;
  ready?: string;
}

export interface K8sEventSummary {
  type: string;
  reason: string;
  message: string;
  involvedObject: string;
  age?: string;
}

export interface OllamaModelParams {
  temperature: number;
  top_p: number;
  top_k: number;
  num_predict: number;
  repeat_penalty: number;
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
  messages: Array<{
    role: string;
    content: string;
  }>;
  stream: boolean;
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
  };
  done: boolean;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}
