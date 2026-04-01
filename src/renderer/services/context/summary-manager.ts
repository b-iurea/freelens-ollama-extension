/**
 * SummaryManager — compresses old conversation turns into a summary
 * by calling Ollama with the current model.
 *
 * The summary call only happens when the conversation exceeds a turn
 * threshold, and it runs on-demand (not every turn).
 *
 * Zero external dependencies (uses the existing nodeRequest helper
 * exposed via OllamaService).
 */

import type { ChatMessage } from "../../../common/types";

/* ── Config ── */

/** Number of user+assistant exchange pairs before triggering summarisation. */
const SUMMARY_THRESHOLD = 20;

/** How many of the most recent messages to keep verbatim (not summarised). */
const KEEP_RECENT_TURNS = 10;

/* ── Types ── */

export interface SummaryResult {
  /** Compressed summary of old turns */
  summary: string;
  /** Number of turns that were summarised */
  summarisedCount: number;
  /** Timestamp of when the summary was generated */
  timestamp: number;
}

/* ── Implementation ── */

export class SummaryManager {
  private currentSummary = "";
  private summarisedUpToIndex = 0;  // messages[0..N] already summarised
  private isSummarising = false;
  private lastSummaryTimestamp = 0;

  /**
   * A generate-summary function injected by the caller so SummaryManager
   * doesn't depend on OllamaService directly.
   *
   * Signature: (prompt: string) => Promise<string>
   */
  private generateFn: ((prompt: string) => Promise<string>) | null = null;

  /**
   * Provide the function that calls Ollama to generate text.
   * Must be called once before `maybeCompress` can work.
   */
  setGenerateFn(fn: (prompt: string) => Promise<string>) {
    this.generateFn = fn;
  }

  /**
   * Get the current summary text (may be empty if no summarisation has happened).
   */
  getSummary(): string {
    return this.currentSummary;
  }

  /**
   * Get the index up to which messages have been summarised.
   */
  getSummarisedUpToIndex(): number {
    return this.summarisedUpToIndex;
  }

  /**
   * Check whether summarisation is currently running.
   */
  isBusy(): boolean {
    return this.isSummarising;
  }

  /**
   * Reset all state (e.g., when conversation is cleared).
   */
  reset() {
    this.currentSummary = "";
    this.summarisedUpToIndex = 0;
    this.isSummarising = false;
    this.lastSummaryTimestamp = 0;
  }

  /**
   * Count exchange pairs (user+assistant) in the message array.
   * A single user or assistant message counts as half a pair.
   */
  private static countTurns(messages: ChatMessage[]): number {
    const eligible = messages.filter((m) => m.role !== "system" && !m.isStreaming);
    return Math.floor(eligible.length / 2);
  }

  /**
   * Determine whether summarisation should run.
   */
  shouldSummarise(messages: ChatMessage[]): boolean {
    if (this.isSummarising) return false;
    if (!this.generateFn) return false;
    const turns = SummaryManager.countTurns(messages);
    return turns > SUMMARY_THRESHOLD;
  }

  /**
   * If the conversation is long enough, compress old turns into a summary.
   *
   * This is safe to call on every message — it's a no-op if the threshold
   * hasn't been reached or a summarisation is already running.
   *
   * @param messages  Full message array
   * @param query     The current user query (used to focus the summary)
   * @returns         The updated summary, or the existing one if nothing changed.
   */
  async maybeCompress(messages: ChatMessage[], query: string): Promise<string> {
    if (!this.shouldSummarise(messages)) return this.currentSummary;
    if (!this.generateFn) return this.currentSummary;

    this.isSummarising = true;
    try {
      // Separate messages into "old" (to summarise) and "recent" (to keep)
      const eligible = messages.filter((m) => m.role !== "system" && !m.isStreaming);
      const cutoff = Math.max(0, eligible.length - KEEP_RECENT_TURNS);
      const oldMessages = eligible.slice(this.summarisedUpToIndex, cutoff);

      if (oldMessages.length < 4) {
        // Not enough new material to warrant a summary call
        return this.currentSummary;
      }

      // Build the text block to summarise
      const transcript = oldMessages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n");

      const prompt = this.currentSummary
        ? `You are a conversation summariser for a Kubernetes SRE assistant.

Below is a previous summary followed by new conversation turns.

PREVIOUS SUMMARY:
${this.currentSummary}

NEW TURNS:
${transcript}

Create an updated summary with TWO clearly labelled sections:

FACTS & DECISIONS:
Bullet-point list of all confirmed K8s facts, resource names, namespaces, errors found, commands executed, fixes applied, and decisions made. Never drop facts from the previous summary — only add or correct them.

ROLLING CONTEXT:
A short paragraph capturing the current troubleshooting thread and open questions, focused on: "${query}".

Output ONLY the two sections, no preamble.`
        : `You are a conversation summariser for a Kubernetes SRE assistant.

Below is a conversation between a user and the assistant.

${transcript}

Create a concise summary with TWO clearly labelled sections:

FACTS & DECISIONS:
Bullet-point list of all confirmed K8s facts, resource names, namespaces, errors found, commands executed, fixes applied, and decisions made.

ROLLING CONTEXT:
A short paragraph capturing the current troubleshooting thread and open questions, focused on: "${query}".

Output ONLY the two sections, no preamble.`;

      console.log(
        "[K8s SRE] SummaryManager: compressing",
        oldMessages.length,
        "turns →",
        `transcript=${transcript.length} chars`,
      );

      const summary = await this.generateFn(prompt);

      if (summary && summary.trim().length > 20) {
        this.currentSummary = summary.trim();
        this.summarisedUpToIndex = cutoff;
        this.lastSummaryTimestamp = Date.now();

        console.log(
          "[K8s SRE] SummaryManager: summary generated →",
          `${this.currentSummary.length} chars,`,
          `covers turns 0..${cutoff}`,
        );
      }

      return this.currentSummary;
    } catch (e: any) {
      console.warn("[K8s SRE] SummaryManager: compression failed:", e?.message);
      return this.currentSummary;
    } finally {
      this.isSummarising = false;
    }
  }

  /**
   * Get the "recent" messages that have NOT been summarised.
   * These should be sent verbatim to the model.
   */
  getRecentMessages(messages: ChatMessage[]): ChatMessage[] {
    const eligible = messages.filter((m) => m.role !== "system" && !m.isStreaming);
    // Always keep at least KEEP_RECENT_TURNS, but also keep anything after summarisedUpToIndex
    const startIndex = Math.max(
      this.summarisedUpToIndex,
      eligible.length - KEEP_RECENT_TURNS,
    );
    return eligible.slice(startIndex);
  }

  /** Expose thresholds for testing / UI. */
  static get SUMMARY_THRESHOLD() { return SUMMARY_THRESHOLD; }
  static get KEEP_RECENT_TURNS() { return KEEP_RECENT_TURNS; }

  /** Timestamp of the last successful summarisation (0 if never). */
  getLastSummaryTimestamp(): number { return this.lastSummaryTimestamp; }
}
