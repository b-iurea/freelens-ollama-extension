/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * App Preferences panel for K8s SRE Assistant
 * Minimal — connection, model, and parameters are configured in the chat UI.
 */

import React, { useCallback, useState } from "react";
import { ChatStore } from "../stores/chat-store";

const chatStore = ChatStore.getInstance();

const sty = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "14px",
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
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    color: "var(--textColorPrimary)",
    cursor: "pointer",
  },
  divider: {
    border: "none",
    borderTop: "1px solid var(--borderColor)",
    margin: "4px 0",
  },
};

export function SrePreferencesInput() {
  const [endpoint, setEndpoint] = useState(chatStore.ollamaEndpoint);
  const [autoRefresh, setAutoRefresh] = useState(chatStore.autoRefreshContext);

  const onEndpointChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEndpoint(val);
    chatStore.setEndpoint(val);
  }, []);

  const onAutoRefreshChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setAutoRefresh(val);
    chatStore.setAutoRefreshContext(val);
  }, []);

  return (
    <div style={sty.container}>
      <div style={sty.section}>
        <label style={sty.label}>Ollama Endpoint</label>
        <div style={sty.sublabel}>
          The URL of your Ollama instance. You can also configure this from the chat UI
          by clicking the Ollama badge.
        </div>
        <input
          style={sty.input}
          type="text"
          value={endpoint}
          onChange={onEndpointChange}
          placeholder="http://localhost:11434"
        />
      </div>

      <hr style={sty.divider} />

      <div style={sty.section}>
        <label style={sty.label}>Behavior</label>
        <label style={sty.checkbox}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={onAutoRefreshChange}
          />
          Auto-refresh cluster context before each message
        </label>
        <div style={sty.sublabel}>
          When enabled, the assistant gathers pods, deployments, services, nodes,
          and events before each response. Model selection, parameters, and connection
          testing are available directly in the chat header.
        </div>
      </div>
    </div>
  );
}

export function SrePreferencesHint() {
  return (
    <span>
      Configure the Ollama endpoint for the K8s SRE Assistant.
      Model selection, parameters, and connection testing are in the chat UI.
    </span>
  );
}
