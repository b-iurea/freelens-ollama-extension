/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Streaming-safe Markdown renderer for chat messages.
 *
 * Instead of regex-replacing markdown inline (which breaks during streaming
 * when code fences are still open), we split the content into *blocks* first
 * (code blocks vs prose) and render each block independently. Incomplete
 * code fences are rendered as `<pre>` so text never "jumps" between styles.
 */

import React, { useMemo } from "react";

/* ── public component ─────────────────────────────────────────────── */

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div
      className="k8s-sre-md"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ── CSS injected once ────────────────────────────────────────────── */

const MD_STYLES = `
.k8s-sre-md { font-size:13px; line-height:1.6; }
.k8s-sre-md h1,.k8s-sre-md h2,.k8s-sre-md h3,.k8s-sre-md h4 {
  margin:12px 0 4px; font-weight:600; color:var(--textColorPrimary,#cdd6f4);
}
.k8s-sre-md h1 { font-size:18px; }
.k8s-sre-md h2 { font-size:16px; }
.k8s-sre-md h3 { font-size:14px; }
.k8s-sre-md h4 { font-size:13px; }
.k8s-sre-md p  { margin:6px 0; }
.k8s-sre-md ul,.k8s-sre-md ol { margin:4px 0; padding-left:20px; }
.k8s-sre-md li { margin:2px 0; }
.k8s-sre-md strong { font-weight:600; }
.k8s-sre-md em { font-style:italic; }
.k8s-sre-md hr { border:none; border-top:1px solid var(--borderColor,#313244); margin:10px 0; }
.k8s-sre-md a { color:#89b4fa; text-decoration:none; }
.k8s-sre-md a:hover { text-decoration:underline; }
.k8s-sre-md code {
  font-family:'JetBrains Mono','Fira Code','Cascadia Code',Menlo,Monaco,Consolas,monospace;
  font-size:12px;
  background:rgba(137,180,250,.1);
  color:#89b4fa;
  padding:1px 5px;
  border-radius:3px;
}
.k8s-sre-md pre {
  margin:8px 0;
  padding:12px 14px;
  border-radius:8px;
  background:#11111b;
  border:1px solid var(--borderColor,#313244);
  overflow-x:auto;
}
.k8s-sre-md pre code {
  background:none;
  color:#cdd6f4;
  padding:0;
  font-size:12px;
  line-height:1.5;
  white-space:pre;
}
.k8s-sre-md .code-header {
  display:flex; justify-content:space-between; align-items:center;
  padding:4px 14px;
  background:rgba(137,180,250,.08);
  border-radius:8px 8px 0 0;
  border:1px solid var(--borderColor,#313244);
  border-bottom:none;
  font-size:11px; color:var(--textColorSecondary,#a6adc8);
}
.k8s-sre-md .code-header+pre { border-radius:0 0 8px 8px; margin-top:0; }
.k8s-sre-md table {
  border-collapse:collapse; margin:8px 0; width:100%; font-size:12px;
}
.k8s-sre-md th,.k8s-sre-md td {
  padding:6px 10px;
  border:1px solid var(--borderColor,#313244);
  text-align:left;
}
.k8s-sre-md th {
  background:rgba(137,180,250,.08);
  font-weight:600;
}
.k8s-sre-md blockquote {
  margin:6px 0; padding:4px 12px;
  border-left:3px solid #89b4fa;
  color:var(--textColorSecondary,#a6adc8);
}
`;

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  try {
    const s = document.createElement("style");
    s.textContent = MD_STYLES;
    document.head.appendChild(s);
  } catch { /* SSR-safe */ }
}

/* ── block-level parser ───────────────────────────────────────────── */

interface Block {
  type: "code" | "prose";
  lang?: string;
  content: string;
  closed: boolean; // code blocks: whether the closing ``` was found
}

/**
 * Split raw markdown into code blocks and prose blocks.
 * Handles incomplete (still-streaming) code fences gracefully.
 */
function splitBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split("\n");
  let current: Block | null = null;

  for (const line of lines) {
    if (current?.type === "code" && !current.closed) {
      // inside a code block
      if (/^```\s*$/.test(line)) {
        current.closed = true;
        current = null;
      } else {
        current.content += (current.content ? "\n" : "") + line;
      }
    } else if (/^```(\w*)/.test(line)) {
      // open a new code block
      const lang = line.match(/^```(\w*)/)?.[1] || "";
      current = { type: "code", lang, content: "", closed: false };
      blocks.push(current);
    } else {
      // prose
      if (!current || current.type !== "prose") {
        current = { type: "prose", content: "", closed: true };
        blocks.push(current);
      }
      current.content += (current.content ? "\n" : "") + line;
    }
  }

  return blocks;
}

/* ── render pipeline ──────────────────────────────────────────────── */

function renderMarkdown(md: string): string {
  ensureStyles();
  const blocks = splitBlocks(md);
  return blocks.map(renderBlock).join("");
}

function renderBlock(block: Block): string {
  if (block.type === "code") {
    return renderCodeBlock(block);
  }
  return renderProse(block.content);
}

function renderCodeBlock(block: Block): string {
  const escaped = escapeHtml(block.content);
  if (block.lang) {
    const header = `<div class="code-header"><span>${escapeHtml(block.lang)}</span></div>`;
    return `${header}<pre><code>${escaped}</code></pre>`;
  }
  return `<pre><code>${escaped}</code></pre>`;
}

/**
 * Render a prose block: tables, headers, bold, italic, lists, links, etc.
 * We only apply inline markdown transforms to prose — never inside code blocks.
 *
 * Tables are detected first and rendered to HTML. Lines that are part of a
 * rendered table are marked with a sentinel prefix so the line-by-line
 * processor passes them through without escaping.
 */
const TABLE_HTML_SENTINEL = "\x00TABLE_HTML\x00";

function renderProse(text: string): string {
  // Tables first (multi-line structure) — returns mix of raw lines and
  // sentinel-prefixed HTML lines for table output.
  const withTables = processSimpleTables(text);

  // Process line by line for block-level elements
  const lines = withTables.split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Table HTML lines — already rendered, pass through
    if (line.startsWith(TABLE_HTML_SENTINEL)) {
      closeList();
      out.push(line.slice(TABLE_HTML_SENTINEL.length));
      continue;
    }

    // Headers
    const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      closeList();
      const level = hMatch[1].length;
      out.push(`<h${level}>${inlineFormat(escapeHtml(hMatch[2]))}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      closeList();
      out.push("<hr/>");
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      closeList();
      out.push(`<blockquote>${inlineFormat(escapeHtml(line.slice(2)))}</blockquote>`);
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inUl) { closeList(); out.push("<ul>"); inUl = true; }
      out.push(`<li>${inlineFormat(escapeHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inOl) { closeList(); out.push("<ol>"); inOl = true; }
      out.push(`<li>${inlineFormat(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Regular text / blank line
    closeList();
    const trimmed = line.trim();
    if (!trimmed) {
      // Empty line = paragraph break (skip consecutive)
      if (out.length > 0 && out[out.length - 1] !== "<br/>") {
        out.push("<br/>");
      }
    } else {
      out.push(`<p>${inlineFormat(escapeHtml(trimmed))}</p>`);
    }
  }
  closeList();
  return out.join("\n");

  function closeList() {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  }
}

/** Apply inline formatting (bold, italic, code, links) to already-escaped HTML */
function inlineFormat(html: string): string {
  // Inline code (must be before bold/italic so backtick content is protected)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links  [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  return html;
}

/* ── helpers ───────────────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function processSimpleTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("|") && line.endsWith("|")) {
      const nextLine = lines[i + 1]?.trim() || "";
      const isSeparator = /^\|[\s\-:|]+\|$/.test(nextLine);

      if (!inTable) {
        result.push(TABLE_HTML_SENTINEL + "<table>");
        inTable = true;
        const cells = line.split("|").filter((c) => c.trim());
        result.push(TABLE_HTML_SENTINEL + "<tr>" + cells.map((c) => `<th>${inlineFormat(escapeHtml(c.trim()))}</th>`).join("") + "</tr>");
        if (isSeparator) i++;
      } else if (/^\|[\s\-:|]+\|$/.test(line)) {
        // skip separator rows inside table
      } else {
        const cells = line.split("|").filter((c) => c.trim());
        result.push(TABLE_HTML_SENTINEL + "<tr>" + cells.map((c) => `<td>${inlineFormat(escapeHtml(c.trim()))}</td>`).join("") + "</tr>");
      }
    } else {
      if (inTable) { result.push(TABLE_HTML_SENTINEL + "</table>"); inTable = false; }
      result.push(lines[i]);
    }
  }
  if (inTable) result.push(TABLE_HTML_SENTINEL + "</table>");
  return result.join("\n");
}
