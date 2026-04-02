/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Fidelity Evaluator — benchmarks compressed K8s context against raw data.
 *
 * No external dependencies (uses Node.js http directly, same as OllamaService).
 *
 * Flow:
 *  1. Send BOTH raw and compressed data to Ollama in parallel with the same
 *     diagnostic prompt → collect Diagnosis A (raw) and Diagnosis B (compressed).
 *  2. Extract resource names (pod/deployment/service/node) from the raw data
 *     and scan Diagnosis B for invented names (hallucination check).
 *  3. Send both diagnoses to Ollama with a Judge Prompt → parse 1-5 score.
 *  4. Compute token savings (chars / 4 approximation) and latency delta.
 *  5. Return a FidelityReport ready for the "Model Fidelity" UI tab.
 */

import http from "http";
import https from "https";
import type { FidelityDiscrepancy, FidelityReport } from "../../common/types";

/* ─── HTTP helper (duplicated from ollama-service to keep this module standalone) ── */

interface NodeResponse { status: number; ok: boolean; body: string }

function nodePost(url: string, body: string, timeoutMs = 120_000): Promise<NodeResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => {
          const s = res.statusCode ?? 0;
          resolve({ status: s, ok: s >= 200 && s < 300, body: data });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Fidelity request timeout")); });
    req.write(body);
    req.end();
  });
}

/* ─── Internal helpers ───────────────────────────────────────────────────── */

/** Approximate token count: OpenAI-style ~4 chars per token. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract all Kubernetes resource names from raw data (string or object).
 * Matches names in common K8s fields: .metadata.name, .name, and also
 * anything that looks like a k8s resource name (lowercase, hyphens, dots).
 */
function extractResourceNames(raw: string): Set<string> {
  const names = new Set<string>();
  // Match values next to common name keys in JSON/YAML
  const jsonNameRe = /"(?:name|metadata\.name|pod|deployment|service|node)"\s*:\s*"([^"]{3,80})"/gi;
  let m: RegExpExecArray | null;
  while ((m = jsonNameRe.exec(raw)) !== null) {
    names.add(m[1].toLowerCase());
  }
  // Also capture bare k8s-style names (e.g. "prometheus-0", "kube-system")
  const k8sNameRe = /\b([a-z][a-z0-9-]{2,63}(?:\.[a-z0-9-]+)*)\b/g;
  let km: RegExpExecArray | null;
  while ((km = k8sNameRe.exec(raw)) !== null) {
    // Only keep multi-segment names or names with dashes — avoids noise
    const candidate = km[1];
    if (candidate.includes("-") || candidate.includes(".")) {
      names.add(candidate.toLowerCase());
    }
  }
  return names;
}

/**
 * Scan a diagnosis text for resource-name-like tokens and return ones that
 * do NOT appear in the known set from the raw data.
 */
function detectHallucinations(diagnosis: string, knownNames: Set<string>): string[] {
  const mentioned = new Set<string>();
  const re = /\b([a-z][a-z0-9-]{2,63}(?:\.[a-z0-9-]+)*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(diagnosis.toLowerCase())) !== null) {
    const name = m[1];
    if (name.includes("-") || name.includes(".")) {
      mentioned.add(name);
    }
  }
  // Filter: only flag names that look like real k8s resources and are unknown
  const stopwords = new Set([
    "crash-loop", "back-off", "out-of-memory", "liveness-probe", "readiness-probe",
    "image-pull", "node-not-ready", "oom-killed", "running-state", "pending-state",
    "kube-system", "default-namespace", "cluster-wide", "multi-container",
  ]);
  const hallucinated: string[] = [];
  for (const name of mentioned) {
    if (!knownNames.has(name) && !stopwords.has(name) && name.split("-").length >= 2) {
      hallucinated.push(name);
    }
  }
  return hallucinated.slice(0, 10); // Cap to 10 to avoid noise
}

/**
 * Parse the judge's 1-5 score from its text response.
 * Accepts "Score: 4", "4/5", "I give it a 3", etc.
 */
function parseJudgeScore(text: string): number | null {
  const patterns = [
    /score[:\s]+([1-5])/i,
    /([1-5])\s*\/\s*5/,
    /\b([1-5])\s*out\s+of\s*5/i,
    /give[s]?\s+(?:it\s+)?(?:a\s+)?([1-5])\b/i,
    /rating[:\s]+([1-5])/i,
    /punteggio[:\s]+([1-5])/i,
    // fallback: first standalone digit 1-5
    /\b([1-5])\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Extract structured discrepancies from the judge text.
 * We look for lines that mention missing info, hallucinations, or severity differences.
 */
function extractDiscrepancies(judgeText: string, hallucinatedResources: string[]): FidelityDiscrepancy[] {
  const discrepancies: FidelityDiscrepancy[] = [];

  // Hallucinations come in first — they are objective
  for (const name of hallucinatedResources) {
    discrepancies.push({
      type: "hallucinated_resource",
      description: `Resource "${name}" was cited in Diagnosis B but is not present in the raw data.`,
    });
  }

  // Mine judge text for common SRE fidelity patterns
  const missingRe = /(?:miss(?:ing|es?)|manca|omit|lacks?|absent|not\s+mention)/i;
  const wrongSevRe = /(?:severity|criticit[àa]|gravit[àa]|underestimat|overestimat|wrong\s+(?:severity|level)|incorrect(?:ly)?)/i;
  const extraRe = /(?:hallucin|invent|fabbric|fabricat|add(?:ed|s)\s+information|extra\s+detail)/i;

  const sentences = judgeText.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (missingRe.test(sentence) && sentence.length > 20) {
      discrepancies.push({ type: "missing_info", description: sentence });
    } else if (wrongSevRe.test(sentence) && sentence.length > 20) {
      discrepancies.push({ type: "wrong_severity", description: sentence });
    } else if (extraRe.test(sentence) && sentence.length > 20) {
      discrepancies.push({ type: "hallucinated_resource", description: sentence });
    }
  }

  // Deduplicate by description prefix
  const seen = new Set<string>();
  return discrepancies.filter((d) => {
    const key = d.description.slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15);
}

/* ─── Single non-streaming Ollama call ──────────────────────────────────── */

interface CallResult { text: string; latencyMs: number; promptTokens: number; evalTokens: number }

/**
 * Parse an Ollama /api/chat response body.
 * Handles both:
 *  - stream:false — single JSON object
 *  - stream:true  — NDJSON (multiple JSON lines); Ollama cloud models sometimes
 *    ignore stream:false and stream anyway
 */
function parseOllamaBody(body: string): { text: string; promptTokens: number; evalTokens: number } {
  // Try single JSON first (expected for stream:false)
  try {
    const data = JSON.parse(body);
    // Qwen3/QwQ thinking models: content may be empty when thinking tokens fill
    // num_predict budget; fall back to the thinking field so we at least get something.
    const text = (data.message?.content as string | undefined)
      || (data.message?.thinking as string | undefined)
      || "";
    return { text, promptTokens: data.prompt_eval_count ?? 0, evalTokens: data.eval_count ?? 0 };
  } catch {
    // Fall back to NDJSON (stream:true response despite stream:false request)
    let text = "";
    let promptTokens = 0;
    let evalTokens = 0;
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk = JSON.parse(trimmed);
        if (chunk.message?.content) text += chunk.message.content as string;
        if (chunk.done) {
          promptTokens = chunk.prompt_eval_count ?? 0;
          evalTokens = chunk.eval_count ?? 0;
        }
      } catch { /* skip malformed lines */ }
    }
    return { text, promptTokens, evalTokens };
  }
}

async function ollamaCall(
  endpoint: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  timeoutMs: number,
): Promise<CallResult> {
  const request = {
    model,
    stream: false,
    // think:false disables extended thinking mode on Qwen3/QwQ models in Ollama.
    // Without this, thinking tokens consume num_predict before any content is emitted.
    // Ignored by models that do not support the option.
    think: false,
    options: { temperature: 0.1, num_predict: 2000, top_p: 0.9, repeat_penalty: 1.1 },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };

  const t0 = Date.now();
  const res = await nodePost(`${endpoint}/api/chat`, JSON.stringify(request), timeoutMs);
  const latencyMs = Date.now() - t0;

  if (!res.ok) throw new Error(`Ollama API error: HTTP ${res.status} — ${res.body.slice(0, 200)}`);

  const parsed = parseOllamaBody(res.body);
  if (!parsed.text) {
    console.warn("[Fidelity] ollamaCall returned empty content. Body preview:", res.body.slice(0, 300));
  }
  return {
    text: parsed.text,
    latencyMs,
    promptTokens: parsed.promptTokens,
    evalTokens: parsed.evalTokens,
  };
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

export interface FidelityEvalOptions {
  /** Full Ollama endpoint, e.g. "http://localhost:11434". */
  endpoint: string;
  /** Model name to use for all three calls (diagnose A, diagnose B, judge). */
  model: string;
  /**
   * The diagnostic prompt template.
   * Use {{data}} as placeholder for the K8s context block.
   * Defaults to a concise SRE root-cause prompt.
   */
  diagnosticPrompt?: string;
  /** Per-call timeout in ms. Defaults to 120 000 (2 min). */
  timeoutMs?: number;
}

const DEFAULT_DIAGNOSTIC_PROMPT = `You are a senior Kubernetes SRE. Analyse the following cluster data and identify the primary problem.
Be concise: state the Root Cause in one sentence, list the top 2-3 supporting signals, and name the affected resource(s).

{{data}}`;

const JUDGE_SYSTEM = `You are an expert evaluator comparing two Kubernetes SRE diagnoses.
Diagnosis A was produced from COMPLETE cluster data.
Diagnosis B was produced from COMPRESSED cluster data.
Your task: assess whether B retains all the critical information from A.`;

const JUDGE_USER_TEMPLATE = `DIAGNOSIS A (from complete data):
---
{{diagA}}
---

DIAGNOSIS B (from compressed data):
---
{{diagB}}
---

Does Diagnosis B contain the same critical information as Diagnosis A?
Respond with:
1. A score from 1 to 5 (5 = identical critical content, 1 = completely different or misleading).
2. A brief explanation of what is missing or wrong in B (if anything).
3. If B introduces resource names not present in A, list them as "Hallucinated: <name>".`;

/**
 * Run a fidelity evaluation: compare model output on raw vs compressed K8s data.
 *
 * Both diagnostic calls are fired in parallel; the judge call runs after both complete.
 *
 * @param rawData   The original K8s context (JSON string or serialisable object).
 * @param compressed  The compressed context string (output of compressForPrompt/buildSystemPrompt).
 * @param options   Endpoint, model, optional overrides.
 */
export async function runFidelityEvaluation(
  rawData: string | object,
  compressed: string,
  options: FidelityEvalOptions,
): Promise<FidelityReport> {
  const { endpoint, model, timeoutMs = 120_000 } = options;
  const diagPromptTemplate = options.diagnosticPrompt ?? DEFAULT_DIAGNOSTIC_PROMPT;
  const rawStr = typeof rawData === "string" ? rawData : JSON.stringify(rawData, null, 2);

  // Build the two diagnostic prompts
  const promptA = diagPromptTemplate.replace("{{data}}", rawStr);
  const promptB = diagPromptTemplate.replace("{{data}}", compressed);

  const systemPrompt = "You are a senior Kubernetes SRE assistant.";

  console.log("[Fidelity] Starting evaluation — model:", model, "| raw chars:", rawStr.length, "| compressed chars:", compressed.length);

  // ── Step 1: Run both diagnostic calls in parallel ───────────────────────
  const [resultA, resultB] = await Promise.all([
    ollamaCall(endpoint, model, systemPrompt, promptA, timeoutMs),
    ollamaCall(endpoint, model, systemPrompt, promptB, timeoutMs),
  ]);

  console.log("[Fidelity] DiagA:", resultA.text.length, "chars,", resultA.latencyMs, "ms");
  console.log("[Fidelity] DiagB:", resultB.text.length, "chars,", resultB.latencyMs, "ms");

  // ── Step 2: Hallucination check ─────────────────────────────────────────
  const knownNames = extractResourceNames(rawStr);
  const hallucinatedResources = detectHallucinations(resultB.text, knownNames);
  console.log("[Fidelity] Hallucinated resources:", hallucinatedResources.length > 0 ? hallucinatedResources : "none");

  // ── Step 3: Judge call ──────────────────────────────────────────────────
  let judgeScore: number | null = null;
  let judgeExplanation = "(judge call skipped)";
  let discrepancies: FidelityDiscrepancy[] = [];

  try {
    const judgeUserMsg = JUDGE_USER_TEMPLATE
      .replace("{{diagA}}", resultA.text)
      .replace("{{diagB}}", resultB.text);

    const judgeResult = await ollamaCall(endpoint, model, JUDGE_SYSTEM, judgeUserMsg, timeoutMs);
    judgeExplanation = judgeResult.text;
    judgeScore = parseJudgeScore(judgeExplanation);
    discrepancies = extractDiscrepancies(judgeExplanation, hallucinatedResources);
    console.log("[Fidelity] Judge score:", judgeScore, "| discrepancies:", discrepancies.length);
  } catch (e: any) {
    console.warn("[Fidelity] Judge call failed:", e?.message);
    judgeExplanation = `(judge call failed: ${e?.message ?? "unknown error"})`;
    // Still produce discrepancies from hallucinationcheck alone
    discrepancies = extractDiscrepancies("", hallucinatedResources);
  }

  // ── Step 4: Metrics ─────────────────────────────────────────────────────

  // compressionRatio: fraction of characters removed
  const compressionRatio = rawStr.length > 0
    ? Math.max(0, 1 - compressed.length / rawStr.length)
    : 0;

  // Token savings (approximate)
  const rawTokens = resultA.promptTokens > 0 ? resultA.promptTokens : approxTokens(rawStr);
  const compTokens = resultB.promptTokens > 0 ? resultB.promptTokens : approxTokens(compressed);
  const tokenSavings = rawTokens - compTokens;

  const latencyDifferenceMs = resultA.latencyMs - resultB.latencyMs;

  // Composite score: 70% judge (normalised to 0-1), 30% hallucination penalty
  const judgeNorm = judgeScore != null ? (judgeScore - 1) / 4 : 0.5; // 1-5 → 0-1
  const hallucinationPenalty = Math.min(0.3, hallucinatedResources.length * 0.05);
  const score = Math.max(0, Math.min(1, judgeNorm - hallucinationPenalty));

  return {
    score: Math.round(score * 100) / 100,
    judgeScore,
    compressionRatio: Math.round(compressionRatio * 1000) / 1000,
    tokenSavings,
    rawLatencyMs: resultA.latencyMs,
    compressedLatencyMs: resultB.latencyMs,
    latencyDifferenceMs,
    hallucinatedResources,
    discrepancies,
    diagnosisA: resultA.text,
    diagnosisB: resultB.text,
    judgeExplanation,
    evaluatedAt: new Date().toISOString(),
    model,
  };
}
