/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Main SRE Chat Component — uses inline styles for maximum compatibility
 */

import { observer } from "mobx-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../common/types";
import { ChatStore } from "../stores/chat-store";
import { MarkdownRenderer } from "./markdown-renderer";

const chatStore = ChatStore.getInstance();

const SUGGESTED_QUERIES = [
  "What's the health status of my cluster?",
  "Are there any pods in CrashLoopBackOff?",
  "Show me recent warning events",
  "What deployments are not fully available?",
  "Analyze resource usage and suggest optimizations",
  "Check for any security concerns",
];

/* ────── inline style objects ────── */

const S = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    width: "100%",
    background: "var(--mainBackground, #1e1e2e)",
    color: "var(--textColorPrimary, #cdd6f4)",
    fontFamily: "var(--font-main, Roboto, sans-serif)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    background: "var(--layoutTabsBackground, #181825)",
    borderBottom: "1px solid var(--borderColor, #313244)",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  backBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    border: "1px solid var(--borderColor, #313244)",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--textColorSecondary, #a6adc8)",
    fontSize: "14px",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
    lineHeight: 1,
  },
  headerTitle: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 600,
    color: "var(--textColorPrimary, #cdd6f4)",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap" as const,
  },
  badge: (ok: boolean) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "3px 10px",
    borderRadius: "12px",
    fontSize: "11px",
    fontWeight: 500,
    background: ok ? "rgba(166,227,161,.12)" : "rgba(243,139,168,.12)",
    color: ok ? "#a6e3a1" : "#f38ba8",
  }),
  dot: (ok: boolean) => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: ok ? "#a6e3a1" : "#f38ba8",
    display: "inline-block",
  }),
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 10px",
    border: "1px solid var(--borderColor, #313244)",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--textColorSecondary, #a6adc8)",
    fontSize: "11px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  modelSelect: {
    padding: "3px 8px",
    border: "1px solid var(--borderColor, #313244)",
    borderRadius: "6px",
    background: "var(--mainBackground, #1e1e2e)",
    color: "var(--textColorPrimary, #cdd6f4)",
    fontSize: "11px",
    outline: "none" as const,
    cursor: "pointer",
    maxWidth: "180px",
  },
  /* context bar */
  ctx: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "6px 16px",
    background: "rgba(137,180,250,.05)",
    borderBottom: "1px solid var(--borderColor, #313244)",
    fontSize: "11px",
    color: "var(--textColorSecondary, #a6adc8)",
    flexShrink: 0,
    flexWrap: "wrap" as const,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "2px 8px",
    borderRadius: "10px",
    background: "rgba(137,180,250,.1)",
    color: "#89b4fa",
    fontWeight: 500,
  },
  chipWarn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "2px 8px",
    borderRadius: "10px",
    background: "rgba(249,226,175,.1)",
    color: "#f9e2af",
    fontWeight: 500,
  },
  /* error */
  errBanner: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 16px",
    background: "rgba(243,139,168,.08)",
    borderBottom: "1px solid rgba(243,139,168,.18)",
    color: "#f38ba8",
    fontSize: "12px",
    flexShrink: 0,
  },
  /* messages area */
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
  },
  /* welcome */
  welcome: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    padding: "30px 20px",
    textAlign: "center" as const,
    gap: "12px",
  },
  welcomeTitle: { fontSize: "18px", fontWeight: 600, margin: 0 },
  welcomeDesc: {
    color: "var(--textColorSecondary, #a6adc8)",
    fontSize: "13px",
    maxWidth: "480px",
    lineHeight: 1.5,
    margin: 0,
  },
  suggestions: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "8px",
    justifyContent: "center",
    marginTop: "6px",
  },
  sugBtn: {
    padding: "7px 14px",
    border: "1px solid var(--borderColor, #313244)",
    borderRadius: "16px",
    background: "transparent",
    color: "var(--textColorPrimary, #cdd6f4)",
    fontSize: "12px",
    cursor: "pointer",
  },
  /* message row */
  msgRow: (isUser: boolean) => ({
    display: "flex",
    gap: "8px",
    width: "50%",
    alignSelf: isUser ? "flex-end" : "flex-start",
    flexDirection: (isUser ? "row-reverse" : "row") as any,
  }),
  avatar: (isUser: boolean) => ({
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: "13px",
    background: isUser ? "#89b4fa" : "#a6e3a1",
    color: "#1e1e2e",
  }),
  bubble: (isUser: boolean) => ({
    padding: "10px 14px",
    borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
    fontSize: "13px",
    lineHeight: 1.6,
    wordBreak: "break-word" as const,
    background: isUser ? "#89b4fa" : "var(--layoutTabsBackground, #181825)",
    color: isUser ? "#1e1e2e" : "var(--textColorPrimary, #cdd6f4)",
    border: isUser ? "none" : "1px solid var(--borderColor, #313244)",
    overflow: "hidden" as const,
  }),
  cursor: {
    display: "inline-block",
    width: 6,
    height: 14,
    background: "#89b4fa",
    marginLeft: 2,
    verticalAlign: "text-bottom",
    borderRadius: 1,
    animation: "k8s-sre-blink .8s infinite",
  },
  /* input area */
  inputArea: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    padding: "10px 16px 14px",
    borderTop: "1px solid var(--borderColor, #313244)",
    background: "var(--layoutTabsBackground, #181825)",
    flexShrink: 0,
  },
  inputWrap: {
    flex: 1,
    display: "flex",
    border: "1px solid var(--borderColor, #313244)",
    borderRadius: "14px",
    background: "var(--mainBackground, #1e1e2e)",
    overflow: "hidden",
  },
  textarea: {
    flex: 1,
    border: "none",
    background: "transparent",
    color: "var(--textColorPrimary, #cdd6f4)",
    padding: "10px 14px",
    fontSize: "13px",
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    minHeight: "20px",
    maxHeight: "120px",
    lineHeight: 1.4,
  },
  sendBtn: (active: boolean) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "none",
    background: active ? "#89b4fa" : "var(--borderColor, #313244)",
    color: "#1e1e2e",
    cursor: active ? "pointer" : "not-allowed",
    flexShrink: 0,
    opacity: active ? 1 : 0.5,
  }),
  stopBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "none",
    background: "#f38ba8",
    color: "#1e1e2e",
    cursor: "pointer",
    flexShrink: 0,
  },
  loadingDots: {
    display: "flex",
    gap: "4px",
    padding: "4px 0",
  },
};

/* Keyframes injected once */
const KEYFRAMES = `
@keyframes k8s-sre-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.15; }
}
@keyframes k8s-sre-dot {
  0%, 80%, 100% { transform: scale(.5); opacity: .3; }
  40% { transform: scale(1); opacity: 1; }
}
`;

/* ────── Components ────── */

export const SreChat = observer(() => {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // scroll to bottom on new content
  const lastMsg = chatStore.lastMessage;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatStore.messages.length, lastMsg?.content]);

  // connect on mount
  useEffect(() => {
    chatStore.checkConnection();
    chatStore.refreshClusterContext();
    const iv = setInterval(() => chatStore.checkConnection(), 30000);
    return () => clearInterval(iv);
  }, []);

  const send = useCallback(async () => {
    if (!input.trim() || chatStore.isLoading) return;
    const msg = input;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    await chatStore.sendMessage(msg);
  }, [input]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    },
    [send],
  );

  const onTaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const connected = chatStore.isOllamaConnected;
  const ctx = chatStore.clusterContext;
  const warnCount = ctx ? ctx.events.filter((ev) => ev.type === "Warning").length : 0;

  return (
    <div style={S.root}>
      {/* inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* ── Header ── */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <button
            style={S.backBtn}
            onClick={() => window.history.back()}
            title="Back to cluster"
          >
            ←
          </button>
          <span style={{ fontSize: "18px" }}>🤖</span>
          <h2 style={S.headerTitle}>K8s SRE Assistant</h2>
        </div>
        <div style={S.headerActions}>
          <span style={S.badge(connected)}>
            <span style={S.dot(connected)} />
            {connected ? "Ollama" : "Disconnected"}
          </span>
          {connected && chatStore.availableModels.length > 0 ? (
            <select
              style={S.modelSelect}
              value={chatStore.ollamaModel}
              onChange={(e) => chatStore.setModel(e.target.value)}
              title="Select AI model"
            >
              {chatStore.availableModels.map((m) => (
                <option key={m.name} value={m.name}>
                  🧠 {m.name}
                </option>
              ))}
            </select>
          ) : connected ? (
            <span style={{ ...S.badge(true), background: "rgba(137,180,250,.12)", color: "#89b4fa" }}>
              🧠 {chatStore.ollamaModel}
            </span>
          ) : null}
          <button style={S.btn} onClick={() => chatStore.refreshClusterContext()} disabled={chatStore.isGatheringContext}>
            🔄 {chatStore.isGatheringContext ? "Scanning…" : "Refresh"}
          </button>
          {chatStore.hasMessages && (
            <button style={S.btn} onClick={() => chatStore.clearMessages()}>🗑️ Clear</button>
          )}
        </div>
      </div>

      {/* ── Context bar ── */}
      {ctx && (
        <div style={S.ctx}>
          <span>📡</span>
          <span style={S.chip}>{ctx.clusterName}</span>
          <span style={S.chip}>🟢 {ctx.nodes.length} Nodes</span>
          <span style={S.chip}>📦 {ctx.pods.length} Pods</span>
          <span style={S.chip}>🚀 {ctx.deployments.length} Deploy</span>
          <span style={S.chip}>🔌 {ctx.services.length} Svc</span>
          {warnCount > 0 && <span style={S.chipWarn}>⚠️ {warnCount} Warn</span>}
        </div>
      )}

      {/* ── Error banner ── */}
      {chatStore.error && (
        <div style={S.errBanner}>
          <span style={{ flex: 1 }}>⚠️ {chatStore.error}</span>
          <button style={{ background: "none", border: "none", color: "#f38ba8", cursor: "pointer", fontSize: "14px" }} onClick={() => chatStore.setError(null)}>✕</button>
        </div>
      )}

      {/* ── Messages ── */}
      <div style={S.messages}>
        {!chatStore.hasMessages ? (
          <div style={S.welcome}>
            <span style={{ fontSize: "48px", opacity: 0.5 }}>🤖</span>
            <h3 style={S.welcomeTitle}>Kubernetes SRE Assistant</h3>
            <p style={S.welcomeDesc}>
              I'm your AI-powered SRE assistant. I can see your cluster's pods, deployments,
              services, nodes, and events. Ask me anything about your Kubernetes infrastructure!
            </p>
            {!connected && (
              <p style={{ ...S.welcomeDesc, color: "#f38ba8" }}>
                ⚠️ Ollama not connected — configure endpoint in <strong>Preferences → K8s SRE Assistant</strong>
              </p>
            )}
            <div style={S.suggestions}>
              {SUGGESTED_QUERIES.map((q) => (
                <button key={q} style={S.sugBtn} onClick={() => { setInput(q); taRef.current?.focus(); }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {chatStore.messages.map((m) => (
              <MsgBubble key={m.id} message={m} />
            ))}
            {chatStore.isLoading && chatStore.lastMessage?.role !== "assistant" && (
              <div style={S.msgRow(false)}>
                <div style={S.avatar(false)}>🤖</div>
                <div style={S.bubble(false)}>
                  <LoadingDots />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      {/* ── Input ── */}
      <div style={S.inputArea}>
        <div style={S.inputWrap}>
          <textarea
            ref={taRef}
            style={S.textarea}
            value={input}
            onChange={onTaChange}
            onKeyDown={onKey}
            placeholder={connected ? "Ask about your cluster… (Shift+Enter for new line)" : "Connect to Ollama first (see Preferences)…"}
            disabled={!connected}
            rows={1}
          />
        </div>
        {chatStore.isLoading ? (
          <button style={S.stopBtn} onClick={() => chatStore.cancelStream()} title="Stop">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
        ) : (
          <button
            style={S.sendBtn(!!input.trim() && connected)}
            onClick={send}
            disabled={!input.trim() || !connected}
            title="Send"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          </button>
        )}
      </div>
    </div>
  );
});

/* ── Single message bubble ── */
const MsgBubble = observer(({ message }: { message: ChatMessage }) => {
  const u = message.role === "user";
  return (
    <div style={S.msgRow(u)}>
      <div style={S.avatar(u)}>{u ? "👤" : "🤖"}</div>
      <div style={S.bubble(u)}>
        {u ? message.content : (
          <>
            <MarkdownRenderer content={message.content} />
            {message.isStreaming && <span style={S.cursor} />}
          </>
        )}
      </div>
    </div>
  );
});

/* ── Loading animation ── */
function LoadingDots() {
  return (
    <div style={S.loadingDots}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--textColorDimmed, #585b70)",
            animation: `k8s-sre-dot 1.4s infinite ease-in-out both`,
            animationDelay: `${-0.32 + i * 0.16}s`,
          }}
        />
      ))}
    </div>
  );
}
