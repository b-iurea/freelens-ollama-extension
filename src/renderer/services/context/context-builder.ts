/**
 * ContextBuilder — assembles the final prompt for Ollama.
 *
 * Ordering (designed to fight "lost-in-the-middle"):
 *   1. System prompt (SRE persona + live K8s cluster data)
 *   2. Compressed summary of old turns (if any)
 *   3. Top-K BM25 retrieved chunks (relevant old context)
 *   4. Recent turns verbatim (last 3-5)
 *   5. Current user message
 *
 * Zero external dependencies.
 */

import type { ChatMessage } from "../../../common/types";
import type { Chunk } from "./chunk-manager";

/* ── Types ── */

export interface AssembledContext {
  /** The ordered message array ready for Ollama */
  messages: Array<{ role: string; content: string }>;
  /** Estimated word count of the full context */
  estimatedWords: number;
  /** Debug info */
  debug: {
    systemPromptWords: number;
    summaryWords: number;
    retrievedChunks: number;
    retrievedWords: number;
    recentTurns: number;
    recentWords: number;
  };
}

/* ── Config ── */

/** Max total word budget (rough). Models with 4k context ≈ 3000 usable tokens. */
const MAX_CONTEXT_WORDS = 2800;

/* ── Helpers ── */

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Deduplicate retrieved chunks against recent turns.
 * If a chunk's text is substantially contained in a recent message, skip it.
 */
function deduplicateChunks(chunks: Chunk[], recentMessages: ChatMessage[]): Chunk[] {
  const recentText = recentMessages.map((m) => m.content.toLowerCase()).join(" ");
  return chunks.filter((c) => {
    // If >60% of the chunk's words appear in recent text, it's redundant
    const cWords = c.text.toLowerCase().split(/\s+/).filter(Boolean);
    const overlap = cWords.filter((w) => recentText.includes(w)).length;
    return overlap / cWords.length < 0.6;
  });
}

/* ── Implementation ── */

export class ContextBuilder {
  /**
   * Assemble the final prompt.
   *
   * @param systemPrompt    Already-built system prompt (SRE persona + K8s data)
   * @param summary         Compressed summary from SummaryManager (may be "")
   * @param retrievedChunks Top-K chunks from BM25Retriever
   * @param recentMessages  Last N verbatim turns from SummaryManager
   * @param userMessage     The current user message
   */
  static assemble(
    systemPrompt: string,
    summary: string,
    retrievedChunks: Chunk[],
    recentMessages: ChatMessage[],
    userMessage: ChatMessage,
  ): AssembledContext {
    const messages: Array<{ role: string; content: string }> = [];

    // 1. System prompt (always first)
    messages.push({ role: "system", content: systemPrompt });
    const systemWords = wordCount(systemPrompt);
    let totalWords = systemWords;

    // 2. Summary of old turns (injected as a system message for clarity)
    let summaryWords = 0;
    if (summary) {
      const summaryBlock = `[CONVERSATION HISTORY SUMMARY]\n${summary}`;
      summaryWords = wordCount(summaryBlock);
      if (totalWords + summaryWords < MAX_CONTEXT_WORDS) {
        messages.push({ role: "system", content: summaryBlock });
        totalWords += summaryWords;
      } else {
        // Truncate summary to fit
        const budget = MAX_CONTEXT_WORDS - totalWords - 200; // keep 200 for recent
        if (budget > 50) {
          const truncated = summary.split(/\s+/).slice(0, budget).join(" ") + "…";
          messages.push({ role: "system", content: `[CONVERSATION HISTORY SUMMARY]\n${truncated}` });
          summaryWords = budget;
          totalWords += summaryWords;
        }
      }
    }

    // 3. Retrieved chunks (deduplicated against recent turns)
    const dedupedChunks = deduplicateChunks(retrievedChunks, recentMessages);
    let retrievedWords = 0;
    const usedChunks: Chunk[] = [];

    if (dedupedChunks.length > 0) {
      // Budget: leave room for recent turns + user message
      const recentEstimate = recentMessages.reduce((s, m) => s + wordCount(m.content), 0);
      const userEstimate = wordCount(userMessage.content);
      const chunkBudget = Math.max(200, MAX_CONTEXT_WORDS - totalWords - recentEstimate - userEstimate - 100);

      let chunkText = "[RELEVANT EARLIER CONTEXT]\n";
      for (const chunk of dedupedChunks) {
        if (retrievedWords + chunk.wordCount > chunkBudget) break;
        chunkText += chunk.text + "\n---\n";
        retrievedWords += chunk.wordCount;
        usedChunks.push(chunk);
      }

      if (usedChunks.length > 0) {
        messages.push({ role: "system", content: chunkText.trimEnd() });
        totalWords += retrievedWords;
      }
    }

    // 4. Recent turns (verbatim, in order)
    let recentWords = 0;
    const recentTurnCount = recentMessages.length;
    for (const msg of recentMessages) {
      // Skip the current user message if it appears in recent (we add it last)
      if (msg.id === userMessage.id) continue;
      const w = wordCount(msg.content);
      messages.push({ role: msg.role, content: msg.content });
      recentWords += w;
      totalWords += w;
    }

    // 5. Current user message (always last)
    const userWords = wordCount(userMessage.content);
    messages.push({ role: "user", content: userMessage.content });
    totalWords += userWords;
    recentWords += userWords;

    return {
      messages,
      estimatedWords: totalWords,
      debug: {
        systemPromptWords: systemWords,
        summaryWords,
        retrievedChunks: usedChunks.length,
        retrievedWords,
        recentTurns: recentTurnCount,
        recentWords,
      },
    };
  }
}
