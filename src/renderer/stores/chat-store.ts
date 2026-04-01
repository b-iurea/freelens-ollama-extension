/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Chat Store - MobX state management for the chat
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import type { ChatMessage, ClusterContext, OllamaModelInfo, OllamaModelParams, OllamaPerformanceStats } from "../../common/types";
import { DEFAULT_MODEL_PARAMS } from "../../common/types";
import { K8sContextService } from "../services/k8s-context-service";
import { OllamaService } from "../services/ollama-service";
import {
  ChunkManager,
  BM25Retriever,
  SummaryManager,
  ContextBuilder,
} from "../services/context";

const SETTINGS_KEY = "k8s-sre-assistant-settings";

interface PersistedSettings {
  ollamaEndpoint: string;
  ollamaModel: string;
  autoRefreshContext: boolean;
  modelParams?: OllamaModelParams;
  selectedNamespace?: string;
  selectedSreMode?: SreModeKey;
}

export type SreModeKey = "auto" | "troubleshoot" | "security" | "cost" | "capacity" | "yaml";

const SESSION_KEY_PREFIX = "k8s-sre-assistant-session";

const SRE_MODE_INSTRUCTIONS: Record<SreModeKey, string> = {
  auto: "Auto mode: infer the best SRE workflow for the user request.",
  troubleshoot: "Troubleshoot mode: prioritize root cause analysis, evidence, and verification steps.",
  security: "Security review mode: prioritize RBAC, PodSecurity, NetworkPolicy, image and secret risks.",
  cost: "Cost check mode: prioritize waste reduction, right-sizing, autoscaling and noisy workloads.",
  capacity: "Capacity planning mode: prioritize saturation signals, scheduling pressure and scaling strategy.",
  yaml: "YAML helper mode: prioritize precise Kubernetes manifests, patches and safe apply guidance.",
};

export class ChatStore {
  messages: ChatMessage[] = [];
  isLoading = false;
  error: string | null = null;
  ollamaEndpoint = "http://localhost:11434";
  ollamaModel = "qwen3.5:cloud"; 
  availableModels: OllamaModelInfo[] = [];
  isOllamaConnected = false;
  clusterContext: ClusterContext | null = null;
  isGatheringContext = false;
  autoRefreshContext = true;
  modelParams: OllamaModelParams = { ...DEFAULT_MODEL_PARAMS };
  selectedNamespace = "__all__";
  selectedSreMode: SreModeKey = "auto";
  availableNamespaces: string[] = [];
  lastPerformanceStats: OllamaPerformanceStats | null = null;

  private ollamaService: OllamaService;
  private chunkManager: ChunkManager;
  private summaryManager: SummaryManager;
  private currentSessionKey = "";
  private static instance: ChatStore | null = null;

  static getInstance(): ChatStore {
    if (!ChatStore.instance) {
      ChatStore.instance = new ChatStore();
    }
    return ChatStore.instance;
  }

  constructor() {
    makeObservable(this, {
      messages: observable,
      isLoading: observable,
      error: observable,
      ollamaEndpoint: observable,
      ollamaModel: observable,
      availableModels: observable,
      isOllamaConnected: observable,
      clusterContext: observable,
      isGatheringContext: observable,
      autoRefreshContext: observable,
      modelParams: observable,
      selectedNamespace: observable,
      selectedSreMode: observable,
      availableNamespaces: observable,
      lastPerformanceStats: observable,
      hasMessages: computed,
      lastMessage: computed,
      setEndpoint: action,
      setModel: action,
      setAutoRefreshContext: action,
      setModelParams: action,
      setSelectedNamespace: action,
      setSelectedSreMode: action,
      syncSettings: action,
      clearMessages: action,
      setError: action,
      checkConnection: action,
      refreshClusterContext: action,
      sendMessage: action,
    });

    this.loadSettings();
    this.ollamaService = new OllamaService(this.ollamaEndpoint, this.ollamaModel);
    this.chunkManager = new ChunkManager();
    this.summaryManager = new SummaryManager();
    // Wire SummaryManager to call Ollama for compression
    this.summaryManager.setGenerateFn((prompt) => this.ollamaService.generateText(prompt));
    this.currentSessionKey = this.buildSessionKey("unknown-cluster", this.selectedNamespace);
    this.loadSessionMessages(this.currentSessionKey);

    // Sync settings across contexts (preferences ↔ cluster page)
    try {
      window.addEventListener("storage", this.onStorageChange);
    } catch {
      // ignore if window is not available
    }
  }

  private loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s: PersistedSettings = JSON.parse(raw);
        if (s.ollamaEndpoint) this.ollamaEndpoint = s.ollamaEndpoint;
        if (s.ollamaModel) this.ollamaModel = s.ollamaModel;
        if (typeof s.autoRefreshContext === "boolean") this.autoRefreshContext = s.autoRefreshContext;
        if (s.modelParams) this.modelParams = { ...DEFAULT_MODEL_PARAMS, ...s.modelParams };
        if (s.selectedNamespace) this.selectedNamespace = s.selectedNamespace;
        if (s.selectedSreMode) this.selectedSreMode = s.selectedSreMode;
      }
    } catch {
      // first run or corrupt data — use defaults
    }
  }

  private saveSettings() {
    try {
      const s: PersistedSettings = {
        ollamaEndpoint: this.ollamaEndpoint,
        ollamaModel: this.ollamaModel,
        autoRefreshContext: this.autoRefreshContext,
        modelParams: this.modelParams,
        selectedNamespace: this.selectedNamespace,
        selectedSreMode: this.selectedSreMode,
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // storage full or unavailable
    }
  }

  /**
   * Re-read settings from localStorage and sync to OllamaService.
   * Bridges preferences ↔ cluster-page contexts that may hold separate singletons.
   */
  syncSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s: PersistedSettings = JSON.parse(raw);
      if (s.ollamaEndpoint && s.ollamaEndpoint !== this.ollamaEndpoint) {
        this.ollamaEndpoint = s.ollamaEndpoint;
        this.ollamaService.setEndpoint(s.ollamaEndpoint);
      }
      if (s.ollamaModel && s.ollamaModel !== this.ollamaModel) {
        this.ollamaModel = s.ollamaModel;
        this.ollamaService.setModel(s.ollamaModel);
      }
      if (typeof s.autoRefreshContext === "boolean") {
        this.autoRefreshContext = s.autoRefreshContext;
      }
      if (s.modelParams) {
        this.modelParams = { ...DEFAULT_MODEL_PARAMS, ...s.modelParams };
      }
      if (s.selectedSreMode) {
        this.selectedSreMode = s.selectedSreMode;
      }
    } catch {
      // ignore parse errors
    }
  }

  private buildSessionKey(clusterName: string, namespace: string): string {
    const c = (clusterName || "unknown-cluster").replace(/\s+/g, "_").toLowerCase();
    const ns = (namespace || "__all__").replace(/\s+/g, "_").toLowerCase();
    return `${SESSION_KEY_PREFIX}:${c}:${ns}`;
  }

  private loadSessionMessages(sessionKey: string) {
    try {
      const raw = localStorage.getItem(sessionKey);
      if (!raw) {
        this.messages = [];
        this.summaryManager.reset();
        return;
      }
      const parsed: ChatMessage[] = JSON.parse(raw);
      this.messages = Array.isArray(parsed)
        ? parsed.map((m) => ({ ...m, isStreaming: false }))
        : [];
      this.summaryManager.reset();
    } catch {
      this.messages = [];
      this.summaryManager.reset();
    }
  }

  private persistSessionMessages() {
    if (!this.currentSessionKey) return;
    try {
      localStorage.setItem(this.currentSessionKey, JSON.stringify(this.messages));
    } catch {
      // ignore storage errors
    }
  }

  private switchSessionScope(clusterName?: string, namespace?: string) {
    const key = this.buildSessionKey(clusterName || "unknown-cluster", namespace || "__all__");
    if (key === this.currentSessionKey) return;
    this.currentSessionKey = key;
    this.loadSessionMessages(key);
  }

  private onStorageChange = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY && e.newValue) {
      runInAction(() => this.syncSettings());
      this.checkConnection();
    }
  };

  get hasMessages(): boolean {
    return this.messages.length > 0;
  }

  get lastMessage(): ChatMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  setEndpoint(endpoint: string) {
    this.ollamaEndpoint = endpoint;
    this.ollamaService.setEndpoint(endpoint);
    this.saveSettings();
  }

  setModel(model: string) {
    this.ollamaModel = model;
    this.ollamaService.setModel(model);
    this.saveSettings();
  }

  setAutoRefreshContext(value: boolean) {
    this.autoRefreshContext = value;
    this.saveSettings();
  }

  setSelectedSreMode(mode: SreModeKey) {
    this.selectedSreMode = mode;
    this.saveSettings();
  }

  setModelParams(params: Partial<OllamaModelParams>) {
    this.modelParams = { ...this.modelParams, ...params };
    this.saveSettings();
  }

  async setSelectedNamespace(ns: string) {
    this.persistSessionMessages();
    this.selectedNamespace = ns;
    this.saveSettings();
    // Immediately clear stale context so the UI doesn't show old data
    runInAction(() => {
      this.clusterContext = null;
    });
    // Re-gather context for the new namespace
    await this.refreshClusterContext();
  }

  clearMessages() {
    this.messages = [];
    this.error = null;
    this.summaryManager.reset();
    this.persistSessionMessages();
  }

  setError(error: string | null) {
    this.error = error;
  }

  async checkConnection() {
    this.syncSettings();
    try {
      const connected = await this.ollamaService.isAvailable();
      const models = connected ? await this.ollamaService.listModels() : [];
      runInAction(() => {
        this.isOllamaConnected = connected;
        if (connected) {
          this.availableModels = models;
          this.error = null;
        } else {
          this.error = "Cannot connect to Ollama. Make sure it's running on " + this.ollamaEndpoint;
          this.availableModels = [];
        }
      });
    } catch (e: any) {
      runInAction(() => {
        this.isOllamaConnected = false;
        this.error = `Connection error: ${e.message}`;
        this.availableModels = [];
      });
    }
  }

  async refreshClusterContext() {
    runInAction(() => { this.isGatheringContext = true; });
    try {
      const ns = this.selectedNamespace === "__all__" ? undefined : this.selectedNamespace;
      const ctx = await K8sContextService.gatherContext(ns);
      runInAction(() => {
        this.clusterContext = ctx;
        // Update available namespaces list
        if (ctx.namespaces.length > 0) {
          this.availableNamespaces = ctx.namespaces;
        }
        this.switchSessionScope(ctx.clusterName, this.selectedNamespace);
      });
      console.log(
        "[K8s SRE] Cluster context refreshed →",
        `ns=${ns ?? "all"}`,
        `pods=${ctx.pods.length}`,
        `deployments=${ctx.deployments.length}`,
        `services=${ctx.services.length}`,
        `nodes=${ctx.nodes.length}`,
        `events=${ctx.events.length}`,
      );
    } catch (e: any) {
      console.warn("[K8s SRE] Failed to gather cluster context:", e);
      // Keep previous context if available rather than wiping it
    } finally {
      runInAction(() => { this.isGatheringContext = false; });
    }
  }

  async sendMessage(content: string) {
    if (!content.trim() || this.isLoading) return;

    // Re-read settings in case preferences changed in another context
    this.syncSettings();

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };
    runInAction(() => { this.messages.push(userMessage); });
    this.persistSessionMessages();

    // Auto-refresh context before each message if enabled
    if (this.autoRefreshContext) {
      await this.refreshClusterContext();
    }

    // Create assistant message placeholder
    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    };
    runInAction(() => {
      this.messages.push(assistantMessage);
      this.isLoading = true;
      this.error = null;
    });

    try {
      /* ── Context pipeline ── */

      // 1. Build system prompt (SRE persona + live K8s data)
      const baseSystemPrompt = this.ollamaService.buildSystemPrompt(
        this.clusterContext || undefined,
      );
      const modeInstruction = SRE_MODE_INSTRUCTIONS[this.selectedSreMode];
      const systemPrompt = `${baseSystemPrompt}\n\n--- ACTIVE SRE MODE ---\n${modeInstruction}`;

      // 2. Use existing summary (computed after previous response, not blocking)
      const summary = this.summaryManager.getSummary();

      // 3. Chunk only non-summarised history for BM25 retrieval
      //    Summarised turns are already captured in the summary —
      //    retrieving them again would waste tokens and add noise.
      const recentMessages = this.summaryManager.getRecentMessages(this.messages);
      const nonSummarisedChunks = this.chunkManager.buildChunks(recentMessages);
      const bm25Index = BM25Retriever.buildIndex(nonSummarisedChunks);
      const retrievedChunks = BM25Retriever.retrieve(bm25Index, userMessage.content, 5);

      // 4. Assemble the final prompt
      const assembled = ContextBuilder.assemble(
        systemPrompt,
        summary,
        retrievedChunks,
        recentMessages,
        userMessage,
      );

      console.log("[K8s SRE] Context pipeline →", JSON.stringify(assembled.debug));

      // 5. Stream via Ollama using the assembled context
      const stream = this.ollamaService.streamChatAssembled(
        assembled.messages,
        { ...this.modelParams },
      );

      for await (const chunk of stream) {
        runInAction(() => {
          const msgIndex = this.messages.findIndex((m) => m.id === assistantMessage.id);
          if (msgIndex >= 0) {
            this.messages[msgIndex] = {
              ...this.messages[msgIndex],
              content: this.messages[msgIndex].content + chunk,
            };
          }
        });
      }

      // Mark streaming as done
      runInAction(() => {
        const finalIndex = this.messages.findIndex((m) => m.id === assistantMessage.id);
        if (finalIndex >= 0) {
          this.messages[finalIndex] = {
            ...this.messages[finalIndex],
            isStreaming: false,
          };
        }
        // Capture performance stats from Ollama's final chunk
        if (this.ollamaService.lastStats) {
          this.lastPerformanceStats = { ...this.ollamaService.lastStats };
        }
      });
      this.persistSessionMessages();

      // 6. Post-response: compress old turns in background if threshold reached.
      //    Runs AFTER the response is delivered so it doesn't add latency.
      //    The summary will be ready for the *next* message.
      if (this.summaryManager.shouldSummarise(this.messages)) {
        this.summaryManager.maybeCompress(this.messages, userMessage.content).catch((e) => {
          console.warn("[K8s SRE] Background summarisation failed:", e?.message);
        });
      }
    } catch (e: any) {
      runInAction(() => {
        this.error = `AI Error: ${e.message}`;
        const errIndex = this.messages.findIndex((m) => m.id === assistantMessage.id);
        if (errIndex >= 0 && !this.messages[errIndex].content) {
          this.messages.splice(errIndex, 1);
        } else if (errIndex >= 0) {
          this.messages[errIndex] = {
            ...this.messages[errIndex],
            isStreaming: false,
          };
        }
      });
      this.persistSessionMessages();
    } finally {
      runInAction(() => { this.isLoading = false; });
    }
  }

  cancelStream() {
    this.ollamaService.cancelStream();
    this.isLoading = false;
  }

  getSuggestedActions(): string[] {
    const actions = new Set<string>();
    const ctx = this.clusterContext;
    const lastUser = [...this.messages].reverse().find((m) => m.role === "user")?.content.toLowerCase() || "";

    if (ctx) {
      const warnings = ctx.events.filter((e) => e.type === "Warning").length;
      if (warnings > 0) actions.add("Show top warning events and likely root causes");
      if (ctx.pods.some((p) => (p.status || "").toLowerCase().includes("crashloop"))) {
        actions.add("Investigate CrashLoopBackOff pods with prioritized fixes");
      }
      if (ctx.deployments.some((d) => {
        const [ready, desired] = (d.replicas || "0/0").split("/").map((n) => Number(n));
        return Number.isFinite(ready) && Number.isFinite(desired) && desired > ready;
      })) {
        actions.add("List deployments with replica mismatch and rollout checks");
      }
    }

    if (this.selectedSreMode === "security" || lastUser.includes("security") || lastUser.includes("rbac")) {
      actions.add("Run a quick RBAC and pod security posture review");
    }
    if (this.selectedSreMode === "cost" || lastUser.includes("cost") || lastUser.includes("resource")) {
      actions.add("Suggest cost optimizations for over-provisioned workloads");
    }
    if (this.selectedSreMode === "yaml" || lastUser.includes("yaml") || lastUser.includes("manifest")) {
      actions.add("Draft a safe YAML patch with explanation and dry-run command");
    }

    if (actions.size === 0) {
      actions.add("Summarize cluster health and top risks right now");
      actions.add("Recommend the next 3 troubleshooting steps");
    }

    return Array.from(actions).slice(0, 5);
  }

  getDataSourceStatus(): Array<{ name: string; status: "ready" | "partial" | "missing"; detail: string }> {
    const c = this.clusterContext;
    if (!c) {
      return [
        { name: "Cluster Context", status: "missing", detail: "No context loaded yet" },
        { name: "Conversation Memory", status: this.messages.length > 0 ? "partial" : "missing", detail: `${this.messages.length} messages` },
      ];
    }

    return [
      { name: "Pods", status: c.pods.length > 0 ? "ready" : "missing", detail: `${c.pods.length} loaded` },
      { name: "Deployments", status: c.deployments.length > 0 ? "ready" : "missing", detail: `${c.deployments.length} loaded` },
      { name: "Services", status: c.services.length > 0 ? "ready" : "missing", detail: `${c.services.length} loaded` },
      { name: "Nodes", status: c.nodes.length > 0 ? "ready" : "missing", detail: `${c.nodes.length} loaded` },
      { name: "Events", status: c.events.length > 0 ? "ready" : "missing", detail: `${c.events.length} loaded` },
      { name: "Conversation Memory", status: this.messages.length > 0 ? "ready" : "partial", detail: `${this.messages.length} messages` },
    ];
  }

  buildIncidentSummaryMarkdown(): string {
    const ctx = this.clusterContext;
    const now = new Date().toISOString();
    const warnings = ctx ? ctx.events.filter((e) => e.type === "Warning") : [];
    const assistantMessages = this.messages.filter((m) => m.role === "assistant" && m.content.trim());
    const lastAssistant = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1].content : "No assistant response yet.";

    return [
      "# Incident Summary",
      "",
      `- Generated: ${now}`,
      `- Cluster: ${ctx?.clusterName || "unknown"}`,
      `- Namespace scope: ${this.selectedNamespace === "__all__" ? "all" : this.selectedNamespace}`,
      `- Active mode: ${this.selectedSreMode}`,
      "",
      "## Context Snapshot",
      "",
      `- Pods: ${ctx?.pods.length ?? 0}`,
      `- Deployments: ${ctx?.deployments.length ?? 0}`,
      `- Services: ${ctx?.services.length ?? 0}`,
      `- Nodes: ${ctx?.nodes.length ?? 0}`,
      `- Warning events: ${warnings.length}`,
      "",
      "## Top Warning Events",
      "",
      ...(warnings.length > 0
        ? warnings.slice(0, 10).map((w) => `- [${w.reason}] ${w.involvedObject}: ${w.message}`)
        : ["- None detected"]),
      "",
      "## Assistant Latest Analysis",
      "",
      lastAssistant,
      "",
      "## Conversation Transcript",
      "",
      ...this.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `### ${m.role.toUpperCase()}\n\n${m.content}\n`),
    ].join("\n");
  }

  exportIncidentSummary(): { ok: boolean; message: string } {
    try {
      const md = this.buildIncidentSummaryMarkdown();
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cluster = (this.clusterContext?.clusterName || "cluster").replace(/\s+/g, "-").toLowerCase();
      const ns = (this.selectedNamespace || "all").replace(/\s+/g, "-").toLowerCase();
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `incident-summary-${cluster}-${ns}-${ts}.md`;
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true, message: "Incident summary exported" };
    } catch (e: any) {
      return { ok: false, message: `Export failed: ${e?.message || "unknown error"}` };
    }
  }
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
