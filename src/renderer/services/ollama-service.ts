/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Ollama AI Service - handles communication with the Ollama API
 */

import type {
  ChatMessage,
  ClusterContext,
  OllamaChatRequest,
  OllamaModelInfo,
  OllamaModelParams,
  OllamaStreamChunk,
} from "../../common/types";

const DEFAULT_ENDPOINT = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";

export class OllamaService {
  private endpoint: string;
  private model: string;
  private abortController: AbortController | null = null;

  constructor(endpoint?: string, model?: string) {
    this.endpoint = endpoint || DEFAULT_ENDPOINT;
    this.model = model || DEFAULT_MODEL;
  }

  setEndpoint(endpoint: string) {
    this.endpoint = endpoint;
  }

  setModel(model: string) {
    this.model = model;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Check if Ollama is reachable
   */
  async isAvailable(): Promise<boolean> {
    const url = `${this.endpoint}/api/tags`;
    console.log("[K8s SRE] Testing connection to:", url);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      console.log("[K8s SRE] Connection response status:", response.status);
      return response.ok;
    } catch (fetchErr) {
      console.warn("[K8s SRE] fetch failed, trying XMLHttpRequest:", fetchErr);
      // Fallback: XMLHttpRequest can bypass some CORS/CSP issues in Electron
      return this.isAvailableXHR(url);
    }
  }

  private isAvailableXHR(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.timeout = 5000;
        xhr.onload = () => {
          console.log("[K8s SRE] XHR response status:", xhr.status);
          resolve(xhr.status >= 200 && xhr.status < 300);
        };
        xhr.onerror = () => {
          console.error("[K8s SRE] XHR error");
          resolve(false);
        };
        xhr.ontimeout = () => {
          console.error("[K8s SRE] XHR timeout");
          resolve(false);
        };
        xhr.send();
      } catch (e) {
        console.error("[K8s SRE] XHR exception:", e);
        resolve(false);
      }
    });
  }

  /**
   * List available models
   */
  async listModels(): Promise<OllamaModelInfo[]> {
    const url = `${this.endpoint}/api/tags`;
    console.log("[K8s SRE] Fetching models from:", url);
    try {
      let data: any;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      } catch (fetchErr) {
        console.warn("[K8s SRE] fetch models failed, trying XHR:", fetchErr);
        data = await this.fetchJsonXHR(url);
      }
      console.log("[K8s SRE] Models response:", JSON.stringify(data?.models?.map((m: any) => m.name)));
      return data?.models || [];
    } catch (error) {
      console.error("[K8s SRE] Failed to list models:", error);
      return [];
    }
  }

  private fetchJsonXHR(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.timeout = 10000;
      xhr.onload = () => {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error("Failed to parse response"));
        }
      };
      xhr.onerror = () => reject(new Error("XHR error"));
      xhr.ontimeout = () => reject(new Error("XHR timeout"));
      xhr.send();
    });
  }

  /**
   * Build system prompt with Kubernetes cluster context
   */
  buildSystemPrompt(clusterContext?: ClusterContext): string {
    let prompt = `You are an expert Kubernetes SRE (Site Reliability Engineer) assistant embedded in Freelens, a professional Kubernetes IDE.

ROLE & PERSONALITY:
- You are a senior SRE with 10+ years of experience managing production Kubernetes clusters.
- You are precise, methodical, and safety-conscious.
- When in doubt, you ask clarifying questions rather than making assumptions.
- You always consider the blast radius of any suggested changes.

CORE COMPETENCIES:
1. TROUBLESHOOTING: Root cause analysis of pod crashes, OOMKills, CrashLoopBackOff, ImagePullBackOff, scheduling failures, networking issues, DNS problems, storage mount failures
2. MONITORING & OBSERVABILITY: Prometheus, Grafana, AlertManager, Loki, Jaeger, OpenTelemetry, metrics interpretation, SLI/SLO/SLA definition
3. SECURITY: RBAC analysis, NetworkPolicy design, PodSecurityStandards, secret management, image scanning, supply chain security, least privilege principle
4. PERFORMANCE: Resource requests/limits tuning, HPA/VPA configuration, cluster autoscaling, JVM/memory optimization, CPU throttling analysis
5. RELIABILITY: PodDisruptionBudgets, anti-affinity rules, topology spread, graceful shutdown, readiness/liveness probes, rolling update strategies
6. NETWORKING: Service mesh (Istio/Linkerd), Ingress controllers, DNS debugging, CNI issues, load balancing, mTLS
7. STORAGE: PV/PVC management, StorageClass configuration, CSI drivers, backup strategies
8. GITOPS & CI/CD: Helm charts, Kustomize, ArgoCD, FluxCD, deployment strategies (blue-green, canary)

RESPONSE FORMAT RULES:
- Use Markdown formatting for readability
- Always put kubectl commands in \`\`\`bash code blocks
- When listing resources, use tables when there are multiple columns
- Prefix dangerous/destructive commands with ⚠️ WARNING
- After diagnosing a problem, always provide: 1) Root cause 2) Immediate fix 3) Long-term prevention
- Keep responses focused and actionable — avoid unnecessary preambles
- When showing YAML manifests, always include necessary comments
- If a question is ambiguous, list the possible interpretations and address each

SAFETY RULES:
- Never suggest \`kubectl delete\` without warning and confirmation guidance
- Always mention \`--dry-run=client\` for apply/create commands when appropriate
- Suggest \`kubectl diff\` before \`kubectl apply\` for changes
- Warn about production impact of any scaling or restart operations
`;

    if (clusterContext) {
      prompt += `\n\n--- CURRENT CLUSTER CONTEXT ---\n`;
      prompt += `Cluster: ${clusterContext.clusterName}\n`;
      prompt += `Active Namespace: ${clusterContext.namespace}\n\n`;

      if (clusterContext.nodes.length > 0) {
        prompt += `NODES (${clusterContext.nodes.length}):\n`;
        for (const node of clusterContext.nodes) {
          prompt += `  - ${node.name} [Status: ${node.status || "Unknown"}]\n`;
        }
        prompt += "\n";
      }

      if (clusterContext.pods.length > 0) {
        prompt += `PODS (${clusterContext.pods.length}):\n`;
        for (const pod of clusterContext.pods) {
          prompt += `  - ${pod.namespace}/${pod.name} [Status: ${pod.status || "Unknown"}, Ready: ${pod.ready || "?"}]\n`;
        }
        prompt += "\n";
      }

      if (clusterContext.deployments.length > 0) {
        prompt += `DEPLOYMENTS (${clusterContext.deployments.length}):\n`;
        for (const dep of clusterContext.deployments) {
          prompt += `  - ${dep.namespace}/${dep.name} [Replicas: ${dep.replicas || "?"}]\n`;
        }
        prompt += "\n";
      }

      if (clusterContext.services.length > 0) {
        prompt += `SERVICES (${clusterContext.services.length}):\n`;
        for (const svc of clusterContext.services) {
          prompt += `  - ${svc.namespace}/${svc.name}\n`;
        }
        prompt += "\n";
      }

      if (clusterContext.events.length > 0) {
        prompt += `RECENT EVENTS (last ${clusterContext.events.length}):\n`;
        for (const event of clusterContext.events) {
          prompt += `  - [${event.type}] ${event.reason}: ${event.message} (${event.involvedObject})\n`;
        }
        prompt += "\n";
      }

      prompt += `--- END CLUSTER CONTEXT ---\n`;
      prompt += `\nUse this information to provide contextual help. If the user asks about cluster status, resource health, or troubleshooting, reference the actual resources visible above.\n`;
    }

    return prompt;
  }

  /**
   * Send a chat message and stream the response
   */
  async *streamChat(
    messages: ChatMessage[],
    clusterContext?: ClusterContext,
    modelParams?: OllamaModelParams,
  ): AsyncGenerator<string, void, unknown> {
    this.abortController = new AbortController();

    const systemPrompt = this.buildSystemPrompt(clusterContext);

    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const plainOptions = modelParams ? { ...modelParams } : undefined;

    const request: OllamaChatRequest = {
      model: this.model,
      messages: apiMessages,
      stream: true,
      ...(plainOptions ? { options: plainOptions } : {}),
    };

    console.log("[K8s SRE] streamChat request →", JSON.stringify({
      model: request.model,
      options: request.options,
      messagesCount: request.messages.length,
    }));

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: HTTP ${response.status} - ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk: OllamaStreamChunk = JSON.parse(line);
            if (chunk.message?.content) {
              yield chunk.message.content;
            }
            if (chunk.done) return;
          } catch {
            // skip malformed JSON lines
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        yield "\n\n*[Response interrupted]*";
        return;
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Send a chat message and get the full response at once
   */
  async chat(
    messages: ChatMessage[],
    clusterContext?: ClusterContext,
    modelParams?: OllamaModelParams,
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(clusterContext);

    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const request: OllamaChatRequest = {
      model: this.model,
      messages: apiMessages,
      stream: false,
      ...(modelParams ? { options: modelParams } : {}),
    };

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.message?.content || "";
  }

  /**
   * Cancel an ongoing stream
   */
  cancelStream() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
