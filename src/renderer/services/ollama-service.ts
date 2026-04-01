/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Ollama AI Service - handles communication with the Ollama API
 *
 * Uses Node.js http/https modules instead of browser fetch/XHR to avoid
 * mixed-content blocking when connecting to remote Ollama instances over
 * plain HTTP from the Electron renderer (preload) process.
 */

import http from "http";
import https from "https";
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

/* ──────────────────────────────────────────────────────────
 *  Node.js HTTP helpers – bypass browser mixed-content rules
 * ────────────────────────────────────────────────────────── */

/** Simple request → full body */
function nodeRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number } = {},
): Promise<{ status: number; ok: boolean; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: opts.method || "GET",
        headers: opts.headers || {},
        timeout: opts.timeout || 30_000,
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => {
          const s = res.statusCode || 0;
          resolve({ status: s, ok: s >= 200 && s < 300, body: data });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Streaming request → returns an async generator of raw string chunks */
function nodeStreamRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number },
): { response: Promise<{ status: number; ok: boolean; stream: AsyncGenerator<string, void, unknown> }>; abort: () => void } {
  let req: http.ClientRequest;
  const response = new Promise<{ status: number; ok: boolean; stream: AsyncGenerator<string, void, unknown> }>((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: opts.method || "POST",
        headers: opts.headers || {},
        timeout: opts.timeout || 300_000,
      },
      (res) => {
        const status = res.statusCode || 0;
        const ok = status >= 200 && status < 300;
        if (!ok) {
          let body = "";
          res.on("data", (c: Buffer) => { body += c.toString(); });
          res.on("end", () => reject(new Error(`Ollama API error: HTTP ${status} - ${body}`)));
          return;
        }
        async function* chunks(): AsyncGenerator<string, void, unknown> {
          const buf: string[] = [];
          let pending: (() => void) | null = null;
          let done = false;
          let err: Error | null = null;
          res.on("data", (c: Buffer) => { buf.push(c.toString()); pending?.(); pending = null; });
          res.on("end", () => { done = true; pending?.(); pending = null; });
          res.on("error", (e) => { err = e; done = true; pending?.(); pending = null; });
          while (true) {
            if (buf.length) { yield buf.shift()!; }
            else if (done) { if (err) throw err; return; }
            else { await new Promise<void>((r) => { pending = r; }); }
          }
        }
        resolve({ status, ok, stream: chunks() });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
  return { response, abort: () => { if (req) req.destroy(); } };
}

/**
 * Exported helper for the ConnectionPanel in sre-chat.tsx to test Ollama
 * connectivity using Node.js HTTP (no mixed-content issues).
 */
export async function nodeRequestJson(
  url: string,
  timeout = 5000,
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await nodeRequest(url, { method: "GET", timeout });
  return { ok: res.ok, status: res.status, data: res.ok ? JSON.parse(res.body) : null };
}

export class OllamaService {
  private endpoint: string;
  private model: string;
  private abortController: AbortController | null = null;
  private currentAbort: (() => void) | null = null;

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
   * Check if Ollama is reachable (uses Node.js http — no mixed-content issues)
   */
  async isAvailable(): Promise<boolean> {
    const url = `${this.endpoint}/api/tags`;
    console.log("[K8s SRE] Testing connection to:", url);
    try {
      const res = await nodeRequest(url, { method: "GET", timeout: 5000 });
      console.log("[K8s SRE] Connection response status:", res.status);
      return res.ok;
    } catch (err) {
      console.warn("[K8s SRE] Connection failed:", err);
      return false;
    }
  }

  /**
   * List available models (uses Node.js http — no mixed-content issues)
   */
  async listModels(): Promise<OllamaModelInfo[]> {
    const url = `${this.endpoint}/api/tags`;
    console.log("[K8s SRE] Fetching models from:", url);
    try {
      const res = await nodeRequest(url, { method: "GET", timeout: 10000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = JSON.parse(res.body);
      console.log("[K8s SRE] Models response:", JSON.stringify(data?.models?.map((m: any) => m.name)));
      return data?.models || [];
    } catch (error) {
      console.error("[K8s SRE] Failed to list models:", error);
      return [];
    }
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
      prompt += `\nIMPORTANT: You MUST use the cluster data above to answer the user's questions. Do NOT suggest 'kubectl' commands to gather information that is already provided above. Analyze the data directly. Only suggest kubectl commands for actions (apply, delete, scale, etc.) or for data that is NOT included above.\n`;
    } else {
      prompt += `\n\n--- NO CLUSTER CONTEXT AVAILABLE ---\n`;
      prompt += `Cluster context could not be gathered. You may suggest kubectl commands to help the user investigate.\n`;
    }

    return prompt;
  }

  /**
   * Send a chat message and stream the response (uses Node.js http — no mixed-content issues)
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
      systemPromptLength: systemPrompt.length,
      hasClusterContext: !!clusterContext,
      contextSummary: clusterContext
        ? `pods=${clusterContext.pods.length} deps=${clusterContext.deployments.length} svc=${clusterContext.services.length} nodes=${clusterContext.nodes.length} events=${clusterContext.events.length}`
        : "none",
    }));

    const body = JSON.stringify(request);
    const { response, abort } = nodeStreamRequest(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      timeout: 300_000,
    });

    this.currentAbort = abort;

    try {
      const { stream } = await response;

      let buffer = "";

      for await (const rawChunk of stream) {
        buffer += rawChunk;

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

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const chunk: OllamaStreamChunk = JSON.parse(buffer);
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
        } catch {
          // ignore
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError" || error.message?.includes("aborted") || error.message?.includes("destroyed")) {
        yield "\n\n*[Response interrupted]*";
        return;
      }
      throw error;
    } finally {
      this.abortController = null;
      this.currentAbort = null;
    }
  }

  /**
   * Send a chat message and get the full response at once (uses Node.js http — no mixed-content issues)
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

    const res = await nodeRequest(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      throw new Error(`Ollama API error: HTTP ${res.status}`);
    }

    const data = JSON.parse(res.body);
    return data.message?.content || "";
  }

  /**
   * Cancel an ongoing stream
   */
  cancelStream() {
    if (this.currentAbort) {
      this.currentAbort();
      this.currentAbort = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
