/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * K8s Context Compressor — two-tier strategy:
 *
 *  all-namespaces:   namespace digests (one line each) + anomaly detail only
 *  single-namespace: all pods / deploys / services of that namespace
 *
 * The raw ClusterContext (with no caps) is compressed here before being
 * handed off to buildSystemPrompt(), keeping token counts predictable
 * regardless of cluster size.
 */

import type {
  ClusterContext,
  CompressedClusterContext,
  ContainerSummary,
  K8sEventSummary,
  K8sResourceSummary,
  NamespaceDigest,
} from "../../../common/types";

/* ─── Sidecar blacklist ─────────────────────────────────────────────────── */

/**
 * Container names that are treated as sidecars.
 * An extension of the running sidecar is excluded from prompt output
 * (they are noise unless they are failing).
 */
export const SIDECAR_BLACKLIST = new Set<string>([
  "istio-proxy",
  "linkerd-proxy",
  "vault-agent",
  "vault-agent-init",
  "fluent-bit",
  "fluentd",
  "filebeat",
  "datadog-agent",
  "otel-collector",
  "opentelemetry-collector",
  "jaeger-agent",
  "envoy",
  "aws-otel-collector",
  "splunk-otel-collector",
  "promtail",
  "vector",
]);

/* ─── Container state helpers ────────────────────────────────────────────── */

function getContainerStateName(status: any): string {
  if (!status) return "Unknown";
  const state = status.state ?? {};
  if (state.running) return "Running";
  if (state.waiting?.reason) return state.waiting.reason as string;
  if (state.terminated?.reason) return state.terminated.reason as string;
  if (state.terminated) return "Terminated";
  return "Unknown";
}

/**
 * Extract per-container summaries from a raw K8s pod object.
 * - Running sidecars are suppressed (no value to the model).
 * - Non-Running containers carry exit code, reason, and restart count.
 */
export function extractContainerSummaries(rawPod: any): ContainerSummary[] {
  const specs: any[] = rawPod.spec?.containers ?? [];
  const statuses: any[] = rawPod.status?.containerStatuses ?? [];

  const statusMap = new Map<string, any>();
  for (const s of statuses) {
    if (s.name) statusMap.set(s.name as string, s);
  }

  const result: ContainerSummary[] = [];

  for (const spec of specs) {
    const name: string = (spec.name as string) ?? "unknown";
    const isSidecar = SIDECAR_BLACKLIST.has(name);
    const isMain = !isSidecar;

    const status = statusMap.get(name);
    const state = getContainerStateName(status);

    // Running sidecars are noise — skip them
    if (isSidecar && state === "Running") continue;

    const summary: ContainerSummary = { name, state, isMain, isSidecar };

    if (status?.restartCount != null && (status.restartCount as number) > 0) {
      summary.restarts = status.restartCount as number;
    }

    // Last termination gives the most useful crash diagnosis info
    const term = status?.lastState?.terminated;
    if (term?.exitCode != null) summary.exitCode = term.exitCode as number;
    if (term?.reason) summary.reason = term.reason as string;

    // Current waiting reason (e.g. "CrashLoopBackOff") overrides
    const waiting = status?.state?.waiting;
    if (waiting?.reason) summary.reason = waiting.reason as string;

    result.push(summary);
  }

  return result;
}

/* ─── Event grouping ─────────────────────────────────────────────────────── */

/** Convert an ISO timestamp to a compact relative string ("3m", "2h", "1d"). */
function ageToRelative(iso: string | undefined): string {
  if (!iso) return "?";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "?";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Returns a compact status·age label so the model can reason about event currency:
 *   ACTIVE·2m  — last seen < 15 minutes ago (very likely still happening)
 *   RECENT·45m — last seen 15m–1h ago (may have resolved)
 *   OLD·4h    — last seen > 1h ago (probably historical)
 */
function eventAgeLabel(iso: string | undefined): string {
  if (!iso) return "?";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "?";
  const m = Math.floor(diffMs / 60_000);
  const rel = ageToRelative(iso);
  if (m < 15) return `ACTIVE·${rel}`;
  if (m < 60) return `RECENT·${rel}`;
  return `OLD·${rel}`;
}

/**
 * Aggregate Warning events grouped by (reason + involvedObject).
 * Returns at most `maxGroups` entries, ordered by occurrence count DESC.
 * Each entry carries `count` (merged occurrences) and `lastSeen` (relative age).
 */
export function groupEventsByReason(
  events: K8sEventSummary[],
  maxGroups = 20,
): K8sEventSummary[] {
  const groups = new Map<string, { event: K8sEventSummary; count: number; latestIso: string }>();

  for (const evt of events) {
    const key = `${evt.reason}|${evt.involvedObject}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      // Keep the most recent event message and timestamp
      if (evt.age && (!existing.latestIso || evt.age > existing.latestIso)) {
        existing.latestIso = evt.age;
        existing.event = evt;
      }
    } else {
      groups.set(key, { event: evt, count: 1, latestIso: evt.age ?? "" });
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxGroups)
    .map(({ event, count, latestIso }) => ({
      ...event,
      count,
      lastSeen: eventAgeLabel(latestIso),
    }));
}

/* ─── Namespace digests ──────────────────────────────────────────────────── */

/**
 * Build a one-line health summary per namespace.
 * Used exclusively in all-namespaces view to replace individual pod listings.
 */
export function buildNamespaceDigests(
  pods: K8sResourceSummary[],
  deployments: K8sResourceSummary[],
  services: K8sResourceSummary[],
  events: K8sEventSummary[],
): NamespaceDigest[] {
  const nsMap = new Map<string, NamespaceDigest>();

  const get = (ns: string): NamespaceDigest => {
    if (!nsMap.has(ns)) {
      nsMap.set(ns, {
        name: ns,
        podCounts: {},
        totalPods: 0,
        totalDeployments: 0,
        degradedDeployments: 0,
        totalServices: 0,
        warningCount: 0,
      });
    }
    return nsMap.get(ns)!;
  };

  for (const pod of pods) {
    const d = get(pod.namespace ?? "default");
    d.totalPods++;
    const s = pod.status ?? "Unknown";
    d.podCounts[s] = (d.podCounts[s] ?? 0) + 1;
  }

  for (const dep of deployments) {
    const d = get(dep.namespace ?? "default");
    d.totalDeployments++;
    const [ready, desired] = (dep.replicas ?? "0/0").split("/").map(Number);
    if (Number.isFinite(ready) && Number.isFinite(desired) && desired > 0 && ready < desired) {
      d.degradedDeployments++;
    }
  }

  for (const svc of services) {
    get(svc.namespace ?? "default").totalServices++;
  }

  for (const evt of events) {
    if (evt.type === "Warning" && evt.namespace) {
      get(evt.namespace).warningCount += evt.count ?? 1;
    }
  }

  // Sort: namespaces with degraded deployments or warnings appear first
  return [...nsMap.values()].sort((a, b) => {
    const aScore = (a.degradedDeployments > 0 ? 2 : 0) + (a.warningCount > 0 ? 1 : 0);
    const bScore = (b.degradedDeployments > 0 ? 2 : 0) + (b.warningCount > 0 ? 1 : 0);
    return bScore - aScore;
  });
}

/* ─── Anomaly detection ──────────────────────────────────────────────────── */

const ANOMALY_STATUS_RE = /crashloop|error|oomkill|imagepullbackoff|errimage|createcontainer/i;

function isAnomalyPodStatus(status: string): boolean {
  if (!status || status === "Running" || status === "Completed" || status === "Succeeded") {
    return false;
  }
  // Explicit set of well-known anomalies
  if (
    status === "Pending" ||
    status === "Terminating" ||
    status === "Unknown"
  ) {
    return true;
  }
  return ANOMALY_STATUS_RE.test(status);
}

/* ─── Main entry point ───────────────────────────────────────────────────── */

/**
 * Compress a full ClusterContext into a prompt-ready CompressedClusterContext.
 *
 * - all-namespaces: namespace digests + anomalies only (no healthy pod list)
 * - single-namespace: all pods/deployments/services for that namespace
 *
 * Both modes include all nodes (cluster-scoped) and grouped warning events.
 */
export function compressForPrompt(
  ctx: ClusterContext,
  viewMode: "all-namespaces" | "single-namespace",
): CompressedClusterContext {
  const warningEvents = ctx.events.filter((e) => e.type === "Warning");
  const groupedWarnings = groupEventsByReason(warningEvents, 20);

  if (viewMode === "all-namespaces") {
    const anomalyPods = ctx.pods.filter((p) => isAnomalyPodStatus(p.status ?? ""));
    const anomalyDeployments = ctx.deployments.filter((d) => {
      const [ready, desired] = (d.replicas ?? "0/0").split("/").map(Number);
      return Number.isFinite(ready) && Number.isFinite(desired) && desired > 0 && ready < desired;
    });
    const namespaceDigests = buildNamespaceDigests(
      ctx.pods,
      ctx.deployments,
      ctx.services,
      ctx.events,
    );

    return {
      viewMode: "all-namespaces",
      clusterName: ctx.clusterName,
      gatheredAt: ctx.gatheredAt,
      nodes: ctx.nodes,
      namespaceDigests,
      anomalyPods,
      anomalyDeployments,
      totalPods: ctx.pods.length,
      totalDeployments: ctx.deployments.length,
      totalServices: ctx.services.length,
      groupedWarnings,
    };
  }

  // single-namespace: pass through all resources for that namespace
  return {
    viewMode: "single-namespace",
    clusterName: ctx.clusterName,
    gatheredAt: ctx.gatheredAt,
    namespace: ctx.namespace,
    nodes: ctx.nodes,
    pods: ctx.pods,
    deployments: ctx.deployments,
    services: ctx.services,
    groupedWarnings,
  };
}
