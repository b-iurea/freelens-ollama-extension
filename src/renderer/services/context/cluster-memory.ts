/**
 * ClusterMemoryService — persists a compact labeled snapshot of cluster state
 * to localStorage so that:
 *
 *  1. The assistant warm-starts at Freelens restart without waiting for a K8s API scan.
 *  2. Each message's system prompt receives only the resources RELEVANT to the
 *     current query (via BM25) plus ALL anomalous resources, instead of the
 *     full list — keeping the context window lean for small models.
 *
 * Storage key:  k8s-sre-memory:{cluster}:{namespace}
 * Max items per snapshot: configurable (default 200 pods, 100 deps, etc.)
 * Snapshot TTL shown in UI but snapshot is always used as fallback.
 *
 * Zero external dependencies beyond BM25Retriever.
 */

import type { ClusterContext, K8sEventSummary, K8sResourceSummary, NamespaceHealthSummary } from "../../../common/types";
import { BM25Retriever } from "./bm25-retriever";
import type { Chunk } from "./chunk-manager";

/* ── Config ── */

const MEMORY_KEY_PREFIX = "k8s-sre-memory";

/** After this many ms the snapshot is considered stale (but still usable). */
export const MEMORY_STALE_MS = 30 * 60 * 1000; // 30 minutes

/** Max resources stored per kind (keeps serialized snapshot under ~100 kB). */
const MAX_STORED_PODS = 200;
const MAX_STORED_DEPS = 120;
const MAX_STORED_SVCS = 120;
const MAX_STORED_EVENTS = 60;

/** How many non-anomalous resources to retrieve per kind for the prompt. */
const TOP_K_PER_KIND = 15;

/* ── Types ── */

export interface ClusterAnomalies {
  crashPods: string[];          // "namespace/name"
  mismatchDeployments: string[]; // "namespace/name"
  notReadyNodes: string[];       // "name"
  warningObjects: string[];      // "Kind/name"
}

export interface ClusterMemorySnapshot {
  savedAt: number;
  clusterName: string;
  namespace: string;
  namespaces: string[];
  pods: K8sResourceSummary[];
  deployments: K8sResourceSummary[];
  services: K8sResourceSummary[];
  nodes: K8sResourceSummary[];
  events: K8sEventSummary[];
  anomalies: ClusterAnomalies;
  /** Cluster-wide health aggregates — computed once at save time, zero extra tokens in prompt header. */
  podStatusCounts: Record<string, number>;
  deploymentHealthSummary: { healthy: number; degraded: number };
  /** Per-namespace health rollup — gives the model global visibility at ~10 tokens/namespace. */
  namespaceHealth: Record<string, NamespaceHealthSummary>;
}

/* ── Helpers ── */

function buildKey(clusterName: string, namespace: string): string {
  const c = (clusterName || "unknown").replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const ns = (namespace || "__all__").replace(/[^a-z0-9]/gi, "_").toLowerCase();
  return `${MEMORY_KEY_PREFIX}:${c}:${ns}`;
}

function extractAnomalies(ctx: ClusterContext): ClusterAnomalies {
  return {
    crashPods: ctx.pods
      .filter((p) => /crashloop|error|oomkilled|imagepullbackoff|errimage/i.test(p.status || ""))
      .map((p) => `${p.namespace}/${p.name}`),

    mismatchDeployments: ctx.deployments
      .filter((d) => {
        const [r, t] = (d.replicas || "0/0").split("/").map(Number);
        return Number.isFinite(r) && Number.isFinite(t) && t > 0 && r < t;
      })
      .map((d) => `${d.namespace}/${d.name}`),

    notReadyNodes: ctx.nodes
      .filter((n) => (n.status || "") !== "Ready")
      .map((n) => n.name),

    warningObjects: Array.from(
      new Set(
        ctx.events
          .filter((e) => (e.type || "").toLowerCase() === "warning")
          .map((e) => e.involvedObject),
      ),
    ).slice(0, 30),
  };
}

/**
 * Convert a list of K8s resources to BM25 Chunks for relevance scoring.
 * The `text` field is a flat string with all searchable fields concatenated.
 */
function toChunks(
  items: K8sResourceSummary[],
  toText: (i: K8sResourceSummary) => string,
): Chunk[] {
  return items.map((item, idx) => {
    const text = toText(item);
    return {
      id: `${idx}`,
      text,
      role: "user" as const,
      turnIndex: idx,
      wordCount: text.split(/\s+/).length,
    };
  });
}

/**
 * Select top-K relevant resources from `pool` for the current query,
 * ensuring all anomalous resources are always included.
 */
function selectRelevant(
  pool: K8sResourceSummary[],
  anomalyIds: Set<string>,
  query: string,
  toText: (i: K8sResourceSummary) => string,
  topK: number,
): K8sResourceSummary[] {
  const anomalous = pool.filter((i) =>
    anomalyIds.has(`${i.namespace}/${i.name}`) || anomalyIds.has(i.name),
  );
  const nonAnomalous = pool.filter(
    (i) => !anomalyIds.has(`${i.namespace}/${i.name}`) && !anomalyIds.has(i.name),
  );

  let relevant: K8sResourceSummary[] = [];
  if (nonAnomalous.length > 0 && query.trim().length > 2) {
    const chunks = toChunks(nonAnomalous, toText);
    const index = BM25Retriever.buildIndex(chunks);
    const hits = BM25Retriever.retrieve(index, query, topK);
    relevant = hits.map((c) => nonAnomalous[Number(c.id)]).filter(Boolean);
  } else {
    relevant = nonAnomalous.slice(0, topK);
  }

  // Merge: anomalous first, dedup
  const seen = new Set<string>();
  const result: K8sResourceSummary[] = [];
  for (const item of [...anomalous, ...relevant]) {
    const key = `${item.namespace ?? ""}/${item.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/* ── Public API ── */

export class ClusterMemoryService {
  /** Persist a fresh cluster snapshot to localStorage. */
  static save(ctx: ClusterContext, namespace: string): void {
    try {
      // Aggregate pod status counts across all pods (done once at save time)
      const podStatusCounts: Record<string, number> = {};
      for (const p of ctx.pods) {
        const s = p.status || "Unknown";
        podStatusCounts[s] = (podStatusCounts[s] ?? 0) + 1;
      }

      // Aggregate deployment health: degraded = ready < desired replicas
      let healthyDeps = 0;
      let degradedDeps = 0;
      for (const d of ctx.deployments) {
        const [r, t] = (d.replicas || "0/0").split("/").map(Number);
        if (Number.isFinite(r) && Number.isFinite(t) && t > 0 && r < t) {
          degradedDeps++;
        } else {
          healthyDeps++;
        }
      }

      // Per-namespace health rollup
      const namespaceHealth: Record<string, NamespaceHealthSummary> = {};
      for (const ns of ctx.namespaces) {
        const nsPods = ctx.pods.filter((p) => p.namespace === ns);
        const nsDeps = ctx.deployments.filter((d) => d.namespace === ns);
        const nsEvents = ctx.events.filter(
          (e) => (e.involvedObject || "").startsWith(ns + "/") || (e.involvedObject || "").includes(`/${ns}/`),
        );

        const nsPodCounts: Record<string, number> = {};
        for (const p of nsPods) {
          const s = p.status || "Unknown";
          nsPodCounts[s] = (nsPodCounts[s] ?? 0) + 1;
        }

        let nsDegraded = 0;
        for (const d of nsDeps) {
          const [r, t] = (d.replicas || "0/0").split("/").map(Number);
          if (Number.isFinite(r) && Number.isFinite(t) && t > 0 && r < t) nsDegraded++;
        }

        namespaceHealth[ns] = {
          podStatusCounts: nsPodCounts,
          totalPods: nsPods.length,
          totalDeployments: nsDeps.length,
          degradedDeployments: nsDegraded,
          warningEvents: nsEvents.filter((e) => (e.type || "").toLowerCase() === "warning").length,
        };
      }

      const snapshot: ClusterMemorySnapshot = {
        savedAt: Date.now(),
        clusterName: ctx.clusterName,
        namespace,
        namespaces: ctx.namespaces,
        pods: ctx.pods.slice(0, MAX_STORED_PODS),
        deployments: ctx.deployments.slice(0, MAX_STORED_DEPS),
        services: ctx.services.slice(0, MAX_STORED_SVCS),
        nodes: ctx.nodes,
        events: ctx.events.slice(0, MAX_STORED_EVENTS),
        anomalies: extractAnomalies(ctx),
        podStatusCounts,
        deploymentHealthSummary: { healthy: healthyDeps, degraded: degradedDeps },
        namespaceHealth,
      };
      const key = buildKey(ctx.clusterName, namespace);
      localStorage.setItem(key, JSON.stringify(snapshot));
      console.log(
        "[K8s SRE Memory] snapshot saved →",
        `cluster=${ctx.clusterName}`,
        `ns=${namespace}`,
        `pods=${snapshot.pods.length}`,
        `deps=${snapshot.deployments.length}`,
        `events=${snapshot.events.length}`,
        `anomalies=crash(${snapshot.anomalies.crashPods.length})+mismatch(${snapshot.anomalies.mismatchDeployments.length})+notReady(${snapshot.anomalies.notReadyNodes.length})`,
      );
    } catch (e: any) {
      console.warn("[K8s SRE Memory] save failed:", e?.message);
    }
  }

  /** Load the last saved snapshot for a cluster+namespace. Returns null if none. */
  static load(clusterName: string, namespace: string): ClusterMemorySnapshot | null {
    try {
      const key = buildKey(clusterName, namespace);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const snap = JSON.parse(raw) as ClusterMemorySnapshot;
      console.log(
        "[K8s SRE Memory] snapshot loaded →",
        `cluster=${snap.clusterName}`,
        `savedAt=${new Date(snap.savedAt).toISOString()}`,
        `stale=${ClusterMemoryService.isStale(snap)}`,
      );
      return snap;
    } catch {
      return null;
    }
  }

  /** True if snapshot age exceeds MEMORY_STALE_MS. */
  static isStale(snap: ClusterMemorySnapshot): boolean {
    return Date.now() - snap.savedAt > MEMORY_STALE_MS;
  }

  /** Age of snapshot in minutes (for UI display). */
  static ageMinutes(snap: ClusterMemorySnapshot): number {
    return Math.round((Date.now() - snap.savedAt) / 60_000);
  }

  /**
   * Build a focused ClusterContext from a snapshot, containing:
   *  - ALL anomalous resources (CrashLoop pods, replica-mismatch deps, NotReady nodes)
   *  - Up to TOP_K_PER_KIND resources most relevant to `query` (via BM25)
   *  - All warning events (capped at 15)
   *  - Total count fields so buildSystemPrompt can display "(X of Y)"
   */
  static queryRelevant(
    snapshot: ClusterMemorySnapshot,
    query: string,
    topK: number = TOP_K_PER_KIND,
  ): ClusterContext {
    const crashSet = new Set(snapshot.anomalies.crashPods);
    const mismatchSet = new Set(snapshot.anomalies.mismatchDeployments);

    const relevantPods = selectRelevant(
      snapshot.pods,
      crashSet,
      query,
      (p) => `${p.name} ${p.namespace ?? ""} ${p.status ?? ""} ${p.ready ?? ""} ${JSON.stringify(p.labels ?? {})}`,
      topK,
    );

    const relevantDeps = selectRelevant(
      snapshot.deployments,
      mismatchSet,
      query,
      (d) => `${d.name} ${d.namespace ?? ""} replicas=${d.replicas ?? ""} ${JSON.stringify(d.labels ?? {})}`,
      topK,
    );

    const relevantSvcs = selectRelevant(
      snapshot.services,
      new Set(), // no anomaly concept for services
      query,
      (s) => `${s.name} ${s.namespace ?? ""} type=${s.status ?? ""}`,
      Math.ceil(topK / 2),
    );

    // Warning events always included (already capped in storage)
    const warningEvents = snapshot.events.filter(
      (e) => (e.type || "").toLowerCase() === "warning",
    ).slice(0, 15);

    return {
      clusterName: snapshot.clusterName,
      namespace: snapshot.namespace,
      namespaces: snapshot.namespaces,
      pods: relevantPods,
      deployments: relevantDeps,
      services: relevantSvcs,
      nodes: snapshot.nodes, // nodes are few — always include all
      events: warningEvents,
      // Carry totals and aggregates for display
      totalPods: snapshot.pods.length,
      totalDeployments: snapshot.deployments.length,
      totalServices: snapshot.services.length,
      totalEvents: snapshot.events.length,
      snapshotAge: snapshot.savedAt,
      podStatusCounts: snapshot.podStatusCounts,
      deploymentHealthSummary: snapshot.deploymentHealthSummary,
      namespaceHealth: snapshot.namespaceHealth,
    };
  }

  /**
   * Convert a snapshot to a full ClusterContext (no filtering).
   * Used when loading warm-start context before the first API call.
   */
  static toFullContext(snapshot: ClusterMemorySnapshot): ClusterContext {
    return {
      clusterName: snapshot.clusterName,
      namespace: snapshot.namespace,
      namespaces: snapshot.namespaces,
      pods: snapshot.pods,
      deployments: snapshot.deployments,
      services: snapshot.services,
      nodes: snapshot.nodes,
      events: snapshot.events,
      snapshotAge: snapshot.savedAt,
      podStatusCounts: snapshot.podStatusCounts,
      deploymentHealthSummary: snapshot.deploymentHealthSummary,
      namespaceHealth: snapshot.namespaceHealth,
    };
  }
}
