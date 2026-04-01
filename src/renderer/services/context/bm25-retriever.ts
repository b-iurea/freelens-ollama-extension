/**
 * BM25Retriever — lightweight keyword-based retrieval (~80 lines of pure TS).
 *
 * Scores each Chunk against a query string using BM25 with parameters
 * k1 = 1.5, b = 0.75 (standard Lucene defaults).
 *
 * Zero external dependencies.
 */

import type { Chunk } from "./chunk-manager";

/* ── Config ── */

const K1 = 1.5;
const B = 0.75;

/* ── Helpers ── */

/** Lowercase + split on non-alphanumeric (cheap tokeniser). */
function tokenise(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/** Simple stop-word set — enough to skip the noisiest words. */
const STOP = new Set([
  "the", "is", "at", "of", "on", "and", "or", "to", "in", "it",
  "for", "an", "be", "by", "are", "was", "were", "been", "has",
  "have", "had", "do", "does", "did", "but", "not", "this", "that",
  "with", "from", "they", "its", "can", "will", "all", "any",
]);

function removeStopWords(tokens: string[]): string[] {
  return tokens.filter((t) => !STOP.has(t));
}

/* ── BM25 Index ── */

export interface BM25Index {
  /** Number of documents (chunks) */
  N: number;
  /** Average document length (in tokens) */
  avgDl: number;
  /** docFreq[term] = how many docs contain the term */
  df: Map<string, number>;
  /** docs[i] = { tokens, tf map, length } */
  docs: Array<{
    chunk: Chunk;
    tokens: string[];
    tf: Map<string, number>;
    len: number;
  }>;
}

export class BM25Retriever {
  /**
   * Build an in-memory BM25 index from a set of chunks.
   * Fast: pure synchronous, no I/O.
   */
  static buildIndex(chunks: Chunk[]): BM25Index {
    const docs: BM25Index["docs"] = [];
    const df = new Map<string, number>();
    let totalLen = 0;

    for (const chunk of chunks) {
      const tokens = removeStopWords(tokenise(chunk.text));
      const tf = new Map<string, number>();
      const seen = new Set<string>();

      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
        if (!seen.has(t)) {
          df.set(t, (df.get(t) || 0) + 1);
          seen.add(t);
        }
      }

      docs.push({ chunk, tokens, tf, len: tokens.length });
      totalLen += tokens.length;
    }

    return {
      N: docs.length,
      avgDl: docs.length > 0 ? totalLen / docs.length : 1,
      df,
      docs,
    };
  }

  /**
   * Retrieve the top-K most relevant chunks for a query.
   */
  static retrieve(index: BM25Index, query: string, topK = 5): Chunk[] {
    if (index.N === 0) return [];

    const qTokens = removeStopWords(tokenise(query));
    if (qTokens.length === 0) return index.docs.slice(0, topK).map((d) => d.chunk);

    const scores: Array<{ chunk: Chunk; score: number }> = [];

    for (const doc of index.docs) {
      let score = 0;
      for (const qt of qTokens) {
        const termFreq = doc.tf.get(qt) || 0;
        if (termFreq === 0) continue;

        const docFreq = index.df.get(qt) || 0;
        // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
        const idf = Math.log((index.N - docFreq + 0.5) / (docFreq + 0.5) + 1);
        // BM25 term score
        const num = termFreq * (K1 + 1);
        const den = termFreq + K1 * (1 - B + B * (doc.len / index.avgDl));
        score += idf * (num / den);
      }
      scores.push({ chunk: doc.chunk, score });
    }

    // Sort descending by score, take top-K
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK).filter((s) => s.score > 0).map((s) => s.chunk);
  }
}
