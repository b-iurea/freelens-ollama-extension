/**
 * ChunkManager — splits conversation history into overlapping chunks
 * for retrieval-augmented context assembly.
 *
 * Uses a word-based sliding window as a cheap ~token proxy.
 * Average English/code token ≈ 0.75 words, so 300 "tokens" ≈ 400 words
 * but we keep the param name "tokens" for clarity.
 *
 * Zero external dependencies.
 */

import type { ChatMessage } from "../../../common/types";

/* ── Public types ── */

export interface Chunk {
  /** Unique id: `chunk_{turnIndex}_{chunkIndex}` */
  id: string;
  /** Raw text of the chunk */
  text: string;
  /** Role that produced this text */
  role: "user" | "assistant";
  /** Index of the turn (message pair) this chunk belongs to */
  turnIndex: number;
  /** Word-count of the chunk (cheap token proxy) */
  wordCount: number;
}

/* ── Config ── */

const DEFAULT_CHUNK_SIZE = 300;   // target words per chunk
const DEFAULT_OVERLAP = 50;       // overlap words between adjacent chunks

/* ── Implementation ── */

/**
 * Tokenise text into words (whitespace-split).
 * Good enough as a token-count proxy for BM25 and budget control.
 */
function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Create overlapping chunks from a single text block.
 */
function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): string[] {
  const w = words(text);
  if (w.length <= chunkSize) return [text.trim()];

  const chunks: string[] = [];
  let start = 0;
  const step = Math.max(1, chunkSize - overlap);
  while (start < w.length) {
    const slice = w.slice(start, start + chunkSize);
    chunks.push(slice.join(" "));
    start += step;
    if (start + overlap >= w.length && start < w.length) {
      // last partial chunk — include remaining
      chunks.push(w.slice(start).join(" "));
      break;
    }
  }
  return chunks;
}

/**
 * ChunkManager: stateless utility that turns a message array into chunks.
 *
 * Call `buildChunks()` every time the history changes (it's fast — pure
 * string splitting, no async, no side effects).
 */
export class ChunkManager {
  private chunkSize: number;
  private overlap: number;

  constructor(chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP) {
    this.chunkSize = chunkSize;
    this.overlap = overlap;
  }

  /**
   * Build chunks from the full message history.
   *
   * Only user + assistant messages are chunked (system messages are excluded
   * because they're handled separately by the system prompt).
   */
  buildChunks(messages: ChatMessage[]): Chunk[] {
    const result: Chunk[] = [];
    let turnIndex = 0;

    for (const msg of messages) {
      if (msg.role === "system" || msg.isStreaming) continue;
      if (!msg.content.trim()) continue;

      const role = msg.role as "user" | "assistant";
      const prefix = role === "user" ? "USER:" : "ASSISTANT:";
      const fullText = `${prefix} ${msg.content}`;
      const parts = chunkText(fullText, this.chunkSize, this.overlap);

      for (let ci = 0; ci < parts.length; ci++) {
        result.push({
          id: `chunk_${turnIndex}_${ci}`,
          text: parts[ci],
          role,
          turnIndex,
          wordCount: words(parts[ci]).length,
        });
      }
      turnIndex++;
    }

    return result;
  }

  /**
   * Estimate the total "token" count of a set of chunks.
   */
  static estimateTokens(chunks: Chunk[]): number {
    return chunks.reduce((sum, c) => sum + c.wordCount, 0);
  }

  /**
   * Estimate word count for a plain string.
   */
  static wordCount(text: string): number {
    return words(text).length;
  }
}
