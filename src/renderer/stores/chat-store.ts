/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Chat Store - MobX state management for the chat
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import type { ChatMessage, ClusterContext, OllamaModelInfo, OllamaModelParams } from "../../common/types";
import { DEFAULT_MODEL_PARAMS } from "../../common/types";
import { K8sContextService } from "../services/k8s-context-service";
import { OllamaService } from "../services/ollama-service";

const SETTINGS_KEY = "k8s-sre-assistant-settings";

interface PersistedSettings {
  ollamaEndpoint: string;
  ollamaModel: string;
  autoRefreshContext: boolean;
  modelParams?: OllamaModelParams;
}

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

  private ollamaService: OllamaService;
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
      hasMessages: computed,
      lastMessage: computed,
      setEndpoint: action,
      setModel: action,
      setAutoRefreshContext: action,
      setModelParams: action,
      syncSettings: action,
      clearMessages: action,
      setError: action,
      checkConnection: action,
      refreshClusterContext: action,
      sendMessage: action,
    });

    this.loadSettings();
    this.ollamaService = new OllamaService(this.ollamaEndpoint, this.ollamaModel);

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
    } catch {
      // ignore parse errors
    }
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

  setModelParams(params: Partial<OllamaModelParams>) {
    this.modelParams = { ...this.modelParams, ...params };
    this.saveSettings();
  }

  clearMessages() {
    this.messages = [];
    this.error = null;
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
      const ctx = await K8sContextService.gatherContext();
      runInAction(() => { this.clusterContext = ctx; });
      console.log(
        "[K8s SRE] Cluster context refreshed →",
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
      const conversationMessages = this.messages
        .filter((m) => m.role !== "system" && !m.isStreaming)
        .concat([userMessage]);

      const stream = this.ollamaService.streamChat(
        conversationMessages,
        this.clusterContext || undefined,
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
      });
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
    } finally {
      runInAction(() => { this.isLoading = false; });
    }
  }

  cancelStream() {
    this.ollamaService.cancelStream();
    this.isLoading = false;
  }
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
