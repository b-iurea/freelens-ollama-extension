/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Simple Markdown renderer for chat messages
 */

import React from "react";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = markdownToHtml(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Basic markdown to HTML converter
 * Handles: headers, bold, italic, code blocks, inline code, lists, links, tables
 */
function markdownToHtml(md: string): string {
  let html = escapeHtml(md);

  // Code blocks (``` ... ```)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    },
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Tables
  html = processSimpleTables(html);

  // Unordered lists
  html = html.replace(/^(\s*)[-*] (.+)$/gm, "$1<li>$2</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr/>");

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, "</p><p>");

  // Line breaks
  html = html.replace(/\n/g, "<br/>");

  // Wrap in paragraph
  if (!html.startsWith("<")) {
    html = `<p>${html}</p>`;
  }

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function processSimpleTables(html: string): string {
  const lines = html.split("\n");
  const result: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("|") && line.endsWith("|")) {
      // Check if next line is separator
      const nextLine = lines[i + 1]?.trim() || "";
      const isSeparator = /^\|[\s\-:|]+\|$/.test(nextLine);

      if (!inTable) {
        result.push("<table>");
        inTable = true;

        // Header row
        const cells = line.split("|").filter((c) => c.trim());
        result.push("<tr>" + cells.map((c) => `<th>${c.trim()}</th>`).join("") + "</tr>");

        if (isSeparator) {
          i++; // skip separator
        }
      } else {
        const cells = line.split("|").filter((c) => c.trim());
        result.push("<tr>" + cells.map((c) => `<td>${c.trim()}</td>`).join("") + "</tr>");
      }
    } else {
      if (inTable) {
        result.push("</table>");
        inTable = false;
      }
      result.push(lines[i]);
    }
  }

  if (inTable) {
    result.push("</table>");
  }

  return result.join("\n");
}
