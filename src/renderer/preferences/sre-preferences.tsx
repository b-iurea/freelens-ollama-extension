/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * App Preferences panel for K8s SRE Assistant
 * Configures Ollama endpoint, model, and system prompt
 *
 * NOTE: We use React local state instead of MobX observer here because
 * the Freelens preferences panel may run in a context where the global
 * MobxReact.observer does not properly track store observables.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ChatStore } from "../stores/chat-store";
import type { OllamaModelInfo } from "../../common/types";

const chatStore = ChatStore.getInstance();

const prefStyles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
    padding: "4px 0",
  },
  section: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 600 as const,
    color: "var(--textColorPrimary)",
  },
  sublabel: {
    fontSize: "11px",
    color: "var(--textColorSecondary)",
    marginBottom: "4px",
  },
  input: {
    padding: "8px 12px",
    border: "1px solid var(--borderColor)",
    borderRadius: "4px",
    background: "var(--inputControlBackground, var(--mainBackground))",
    color: "var(--textColorPrimary)",
    fontSize: "13px",
    outline: "none" as const,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  select: {
    padding: "8px 12px",
    border: "1px solid var(--borderColor)",
    borderRadius: "4px",
    background: "var(--inputControlBackground, var(--mainBackground))",
    color: "var(--textColorPrimary)",
    fontSize: "13px",
    outline: "none" as const,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  button: {
    padding: "6px 16px",
    border: "1px solid var(--borderColor)",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--textColorPrimary)",
    fontSize: "12px",
    cursor: "pointer",
  },
  buttonPrimary: {
    padding: "6px 16px",
    border: "1px solid var(--colorInfo, #89b4fa)",
    borderRadius: "4px",
    background: "var(--colorInfo, #89b4fa)",
    color: "#1e1e2e",
    fontSize: "12px",
    cursor: "pointer",
    fontWeight: 600 as const,
  },
  statusOk: {
    color: "var(--colorOk, #a6e3a1)",
    fontSize: "12px",
    fontWeight: 500 as const,
  },
  statusErr: {
    color: "var(--colorError, #f38ba8)",
    fontSize: "12px",
    fontWeight: 500 as const,
  },
  divider: {
    border: "none",
    borderTop: "1px solid var(--borderColor)",
    margin: "4px 0",
  },
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    color: "var(--textColorPrimary)",
    cursor: "pointer",
  },
};

export function SrePreferencesInput() {
  const [endpoint, setEndpoint] = useState(chatStore.ollamaEndpoint);
  const [model, setModel] = useState(chatStore.ollamaModel);
  const [autoRefresh, setAutoRefresh] = useState(chatStore.autoRefreshContext);
  const [connected, setConnected] = useState(false);
  const [models, setModels] = useState<OllamaModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>("");

  // Test connection and fetch models
  const testConnection = useCallback(async () => {
    setTesting(true);
    setError(null);
    setDebugInfo("Starting connection test...");
    const ep = endpoint.replace(/\/+$/, ""); // strip trailing slashes
    chatStore.setEndpoint(ep);
    setEndpoint(ep);

    const url = `${ep}/api/tags`;
    const logs: string[] = [`Testing: ${url}`];

    try {
      let data: any;
      let method = "fetch";

      // Try fetch
      try {
        logs.push("Trying fetch...");
        setDebugInfo(logs.join("\n"));
        const resp = await fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        logs.push(`fetch status: ${resp.status} ok: ${resp.ok}`);
        logs.push(`fetch type: ${resp.type}`);
        setDebugInfo(logs.join("\n"));

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const text = await resp.text();
        logs.push(`Response body length: ${text.length}`);
        logs.push(`Response body preview: ${text.substring(0, 200)}`);
        setDebugInfo(logs.join("\n"));

        data = JSON.parse(text);
      } catch (fetchErr: any) {
        logs.push(`fetch error: ${fetchErr.message}`);
        logs.push("Trying XHR fallback...");
        setDebugInfo(logs.join("\n"));
        method = "XHR";

        // Fallback: XHR
        data = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          xhr.timeout = 5000;
          xhr.onload = () => {
            logs.push(`XHR status: ${xhr.status}`);
            logs.push(`XHR body length: ${xhr.responseText.length}`);
            logs.push(`XHR body preview: ${xhr.responseText.substring(0, 200)}`);
            setDebugInfo(logs.join("\n"));
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error("JSON parse error")); }
          };
          xhr.onerror = () => {
            logs.push("XHR network error");
            setDebugInfo(logs.join("\n"));
            reject(new Error("XHR network error"));
          };
          xhr.ontimeout = () => {
            logs.push("XHR timeout");
            setDebugInfo(logs.join("\n"));
            reject(new Error("XHR timeout"));
          };
          xhr.send();
        });
      }

      const modelList: OllamaModelInfo[] = data?.models || [];
      logs.push(`✓ Connected via ${method}. Models found: ${modelList.length}`);
      if (modelList.length > 0) {
        logs.push(`Models: ${modelList.map((m: any) => m.name).join(", ")}`);
      } else {
        logs.push("⚠ No models found. Run: ollama pull llama3.2");
      }
      setDebugInfo(logs.join("\n"));

      setConnected(true);
      setModels(modelList);
      chatStore.isOllamaConnected = true;
      chatStore.availableModels = modelList;
      chatStore.error = null;

      if (modelList.length > 0 && !modelList.find((m) => m.name === model)) {
        const first = modelList[0].name;
        setModel(first);
        chatStore.setModel(first);
      }
    } catch (e: any) {
      logs.push(`✕ FAILED: ${e.message}`);
      logs.push("Hints:");
      logs.push("- Is Ollama running? (ollama serve)");
      logs.push("- For remote: set OLLAMA_ORIGINS=* on the Ollama host");
      logs.push("- For remote: set OLLAMA_HOST=0.0.0.0:11434");
      setDebugInfo(logs.join("\n"));
      setConnected(false);
      setModels([]);
      setError(`Connection failed: ${e.message}`);
    } finally {
      setTesting(false);
    }
  }, [endpoint, model]);

  // Check connection on mount
  useEffect(() => {
    testConnection();
  }, []);

  // Sync endpoint to store on change
  const onEndpointChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEndpoint(val);
    chatStore.setEndpoint(val);
  }, []);

  // Sync model to store on change
  const onModelChange = useCallback((val: string) => {
    setModel(val);
    chatStore.setModel(val);
  }, []);

  // Sync auto-refresh to store on change
  const onAutoRefreshChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setAutoRefresh(val);
    chatStore.setAutoRefreshContext(val);
  }, []);

  return (
    <div style={prefStyles.container}>
      {/* Connection Settings */}
      <div style={prefStyles.section}>
        <label style={prefStyles.label}>Ollama Endpoint</label>
        <div style={prefStyles.sublabel}>
          The URL of your Ollama instance (e.g. http://localhost:11434)
        </div>
        <div style={prefStyles.row}>
          <input
            style={prefStyles.input}
            type="text"
            value={endpoint}
            onChange={onEndpointChange}
            placeholder="http://localhost:11434"
          />
          <button
            style={prefStyles.buttonPrimary}
            onClick={testConnection}
            disabled={testing}
          >
            {testing ? "Testing…" : "Test Connection"}
          </button>
        </div>
        {connected ? (
          <span style={prefStyles.statusOk}>✓ Connected to Ollama</span>
        ) : error ? (
          <span style={prefStyles.statusErr}>✕ {error}</span>
        ) : null}
        {debugInfo && (
          <pre style={{
            fontSize: "10px",
            fontFamily: "monospace",
            background: "rgba(0,0,0,.3)",
            color: "#a6adc8",
            padding: "8px",
            borderRadius: "4px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: "200px",
            overflow: "auto",
            margin: "4px 0 0 0",
          }}>{debugInfo}</pre>
        )}
      </div>

      <hr style={prefStyles.divider} />

      {/* Model Selection */}
      <div style={prefStyles.section}>
        <label style={prefStyles.label}>AI Model</label>
        <div style={prefStyles.sublabel}>
          Select the Ollama model to use for the SRE assistant
        </div>
        {models.length > 0 ? (
          <div style={prefStyles.row}>
            <select
              style={prefStyles.select}
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({(m.size / 1e9).toFixed(1)} GB)
                </option>
              ))}
            </select>
            <button
              style={prefStyles.button}
              onClick={testConnection}
            >
              Refresh Models
            </button>
          </div>
        ) : (
          <div>
            <input
              style={prefStyles.input}
              type="text"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder="llama3.2"
            />
            <div style={{ ...prefStyles.sublabel, marginTop: "4px" }}>
              Connect to Ollama first to see available models, or type a model name manually
            </div>
          </div>
        )}
      </div>

      <hr style={prefStyles.divider} />

      {/* Behavior */}
      <div style={prefStyles.section}>
        <label style={prefStyles.label}>Behavior</label>
        <label style={prefStyles.checkbox}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={onAutoRefreshChange}
          />
          Auto-refresh cluster context before each message
        </label>
        <div style={prefStyles.sublabel}>
          When enabled, the assistant automatically gathers the current state of pods,
          deployments, services, nodes, and events before responding.
        </div>
      </div>
    </div>
  );
}

export function SrePreferencesHint() {
  return (
    <span>
      Configure the AI provider and model for the Kubernetes SRE Assistant chat.
      Make sure Ollama is running and has at least one model pulled (e.g.{" "}
      <code>ollama pull llama3.2</code>).
    </span>
  );
}
