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
  OllamaPerformanceStats,
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

  /** Performance stats from the last completed stream. */
  lastStats: OllamaPerformanceStats | null = null;

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

  /** Parse performance stats from the final Ollama streaming chunk. */
  private parseStats(chunk: OllamaStreamChunk): OllamaPerformanceStats | null {
    if (!chunk.done) return null;
    const ns = 1_000_000; // nanoseconds → milliseconds
    const totalMs = (chunk.total_duration || 0) / ns;
    const promptMs = (chunk.prompt_eval_duration || 0) / ns;
    const genMs = (chunk.eval_duration || 0) / ns;
    const promptTokens = chunk.prompt_eval_count || 0;
    const genTokens = chunk.eval_count || 0;
    return {
      model: chunk.model || this.model,
      totalDurationMs: Math.round(totalMs),
      promptTokens,
      promptEvalMs: Math.round(promptMs),
      promptTokensPerSec: promptMs > 0 ? Math.round((promptTokens / promptMs) * 1000) : 0,
      generatedTokens: genTokens,
      generationMs: Math.round(genMs),
      tokensPerSec: genMs > 0 ? parseFloat(((genTokens / genMs) * 1000).toFixed(1)) : 0,
      loadMs: Math.round((chunk.load_duration || 0) / ns),
      timestamp: Date.now(),
    };
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
   * Build system prompt with Kubernetes cluster context.
   * Optimised for small models: concise, structured, low token count.
   */
  buildSystemPrompt(clusterContext?: ClusterContext): string {
    let prompt = `You are an expert Kubernetes SRE assistant embedded in Freelens (a K8s IDE).

ROLE: Senior SRE with deep expertise in troubleshooting, monitoring, security, performance, and reliability of Kubernetes clusters.

RULES:
- Use Markdown. Put kubectl commands in \`\`\`bash blocks.
- Prefix destructive commands with ⚠️ WARNING.
- For problems: give Root Cause → Immediate Fix → Long-term Prevention.
- Analyse the LIVE cluster data below FIRST. Only suggest kubectl for actions or data NOT already provided.
- Never suggest \`kubectl delete\` without warning. Mention \`--dry-run=client\` where appropriate.
`;

    if (clusterContext) {
      const scope = clusterContext.namespace;
      prompt += `\n--- LIVE CLUSTER CONTEXT ---\n`;
      prompt += `Cluster: ${clusterContext.clusterName}\n`;
      prompt += `Scope: ${scope}\n`;

      // Namespaces (compact list)
      if (clusterContext.namespaces.length > 0) {
        prompt += `Namespaces (${clusterContext.namespaces.length}): ${clusterContext.namespaces.join(", ")}\n`;
      }

      // Nodes (always cluster-scoped)
      if (clusterContext.nodes.length > 0) {
        prompt += `\nNODES (${clusterContext.nodes.length}):\n`;
        for (const n of clusterContext.nodes) {
          prompt += `  ${n.name} [${n.status || "?"}]\n`;
        }
      }

      // Helper: group resources by namespace for compact display
      const groupByNs = <T extends { namespace?: string }>(items: T[]): Map<string, T[]> => {
        const m = new Map<string, T[]>();
        for (const item of items) {
          const ns = item.namespace || "default";
          if (!m.has(ns)) m.set(ns, []);
          m.get(ns)!.push(item);
        }
        return m;
      };

      // Pods
      if (clusterContext.pods.length > 0) {
        const byNs = groupByNs(clusterContext.pods);
        prompt += `\nPODS (${clusterContext.pods.length}):\n`;
        for (const [ns, pods] of byNs) {
          prompt += `  [${ns}]\n`;
          for (const p of pods) {
            prompt += `    ${p.name}  ${p.status || "?"}  ready=${p.ready || "?"}\n`;
          }
        }
      }

      // Deployments
      if (clusterContext.deployments.length > 0) {
        const byNs = groupByNs(clusterContext.deployments);
        prompt += `\nDEPLOYMENTS (${clusterContext.deployments.length}):\n`;
        for (const [ns, deps] of byNs) {
          prompt += `  [${ns}]\n`;
          for (const d of deps) {
            prompt += `    ${d.name}  replicas=${d.replicas || "?"}\n`;
          }
        }
      }

      // Services
      if (clusterContext.services.length > 0) {
        const byNs = groupByNs(clusterContext.services);
        prompt += `\nSERVICES (${clusterContext.services.length}):\n`;
        for (const [ns, svcs] of byNs) {
          prompt += `  [${ns}]\n`;
          for (const s of svcs) {
            prompt += `    ${s.name}  type=${s.status || "ClusterIP"}\n`;
          }
        }
      }

      // Events — warnings first, then a few normals
      if (clusterContext.events.length > 0) {
        const warnings = clusterContext.events.filter(e => e.type === "Warning");
        const normals = clusterContext.events.filter(e => e.type !== "Warning");
        prompt += `\nEVENTS (${clusterContext.events.length}, ${warnings.length} warnings):\n`;
        if (warnings.length > 0) {
          prompt += `  ⚠ WARNINGS:\n`;
          for (const e of warnings) {
            prompt += `    [${e.reason}] ${e.involvedObject}: ${e.message}\n`;
          }
        }
        if (normals.length > 0) {
          const show = normals.slice(0, 10);
          prompt += `  NORMAL (latest ${show.length}):\n`;
          for (const e of show) {
            prompt += `    [${e.reason}] ${e.involvedObject}: ${e.message}\n`;
          }
        }
      }

      prompt += `--- END CLUSTER CONTEXT ---\n`;
    } else {
      prompt += `\n(No cluster context available — suggest kubectl commands to investigate.)\n`;
    }

    return prompt;
  }

  /**
   * Low-level non-streaming completion — used by SummaryManager to compress
   * conversation history.  Returns the model's text response.
   */
  async generateText(prompt: string): Promise<string> {
    const request: OllamaChatRequest = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      options: { temperature: 0.3, top_p: 0.9, top_k: 40, num_predict: 512, repeat_penalty: 1.0 },
    };

    console.log("[K8s SRE] generateText (summary) →", `model=${this.model}`, `prompt=${prompt.length} chars`);

    const res = await nodeRequest(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      timeout: 60_000,
    });

    if (!res.ok) throw new Error(`Ollama API error: HTTP ${res.status}`);
    const data = JSON.parse(res.body);
    return data.message?.content || "";
  }

  /**
   * Send a chat message and stream the response (uses Node.js http — no mixed-content issues)
   *
   * Accepts either the legacy (messages + clusterContext) signature or
   * a pre-assembled message array from ContextBuilder.
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

  /**
   * Stream a chat using a pre-assembled message array (from ContextBuilder).
   * This bypasses buildSystemPrompt — the caller is responsible for the full
   * message list including system prompt, summary, chunks, recent turns.
   */
  async *streamChatAssembled(
    assembledMessages: Array<{ role: string; content: string }>,
    modelParams?: OllamaModelParams,
  ): AsyncGenerator<string, void, unknown> {
    this.abortController = new AbortController();
    this.lastStats = null;

    const request: OllamaChatRequest = {
      model: this.model,
      messages: assembledMessages,
      stream: true,
      ...(modelParams ? { options: { ...modelParams } } : {}),
    };

    console.log("[K8s SRE] streamChatAssembled →", JSON.stringify({
      model: request.model,
      messagesCount: request.messages.length,
      totalChars: request.messages.reduce((s, m) => s + m.content.length, 0),
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
            if (chunk.message?.content) yield chunk.message.content;
            if (chunk.done) {
              this.lastStats = this.parseStats(chunk);
              if (this.lastStats) {
                console.log("[K8s SRE] Performance →", JSON.stringify(this.lastStats));
              }
              return;
            }
          } catch { /* skip malformed */ }
        }
      }

      if (buffer.trim()) {
        try {
          const chunk: OllamaStreamChunk = JSON.parse(buffer);
          if (chunk.message?.content) yield chunk.message.content;
          if (chunk.done) {
            this.lastStats = this.parseStats(chunk);
          }
        } catch { /* ignore */ }
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
}
