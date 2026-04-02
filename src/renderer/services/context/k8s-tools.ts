/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * K8s Tool Definitions — readonly cluster inspection tools for Ollama tool-calling.
 *
 * Design:
 *  - All executors operate exclusively on the in-memory ClusterContext (no API calls).
 *  - Tool results are serialized as compact plain text using the same token-saving
 *    patterns as the main compressor (groupEventsByReason, extractContainerSummaries).
 *  - The system prompt already carries the "map" (namespace digests / anomalies).
 *    Tools provide "zoom" — on-demand detail for a specific namespace, pod, or resource.
 */

import type {
  ClusterContext,
  K8sResourceSummary,
  OllamaTool,
} from "../../../common/types";
import { groupEventsByReason } from "./k8s-compressor";

/* ─── Tool schema definitions ───────────────────────────────────────────── */

export const K8S_TOOLS: OllamaTool[] = [
  {
    type: "function",
    function: {
      name: "get_namespace_detail",
      description:
        "Get the full list of pods, deployments, and services for a specific namespace. " +
        "Use this when you need to see ALL resources in a namespace, not just anomalies. " +
        "Especially useful when viewing all-namespaces scope and need to drill into one.",
      parameters: {
        type: "object",
        required: ["namespace"],
        properties: {
          namespace: {
            type: "string",
            description: "The Kubernetes namespace to inspect (e.g. 'production', 'kube-system').",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pod_detail",
      description:
        "Get detailed status of a specific pod: container states, restart counts, exit codes, " +
        "termination reasons, and recent warning events related to that pod.",
      parameters: {
        type: "object",
        required: ["name", "namespace"],
        properties: {
          name: { type: "string", description: "Pod name." },
          namespace: { type: "string", description: "Pod namespace." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_resource_events",
      description:
        "Get recent warning events for a specific Kubernetes resource (pod, deployment, service, etc.). " +
        "Events are grouped by reason and sorted by frequency.",
      parameters: {
        type: "object",
        required: ["name", "namespace"],
        properties: {
          name: {
            type: "string",
            description: "Name of the resource to fetch events for.",
          },
          namespace: { type: "string", description: "Resource namespace." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_deployment_detail",
      description:
        "Get replica status and pod states for a specific deployment. " +
        "Returns the deployment's desired vs ready replicas and the state of its pods.",
      parameters: {
        type: "object",
        required: ["name", "namespace"],
        properties: {
          name: { type: "string", description: "Deployment name." },
          namespace: { type: "string", description: "Deployment namespace." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_nodes",
      description:
        "Get all cluster nodes with their Ready/NotReady status. " +
        "Use when investigating scheduling failures or node-level issues.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
      },
    },
  },
];

/* ─── Shared rendering helpers ──────────────────────────────────────────── */

function renderPods(pods: K8sResourceSummary[]): string {
  if (pods.length === 0) return "  (none)\n";
  let out = "";
  for (const p of pods) {
    const isAnomaly =
      (p.status ?? "") !== "Running" &&
      (p.status ?? "") !== "Completed" &&
      (p.status ?? "") !== "Succeeded" &&
      (p.status ?? "") !== "";
    const flag = isAnomaly ? " ⚠" : "";
    out += `  ${p.name}  ${p.status ?? "?"}  ready=${p.ready ?? "?"}${flag}\n`;
    if (p.containers && p.containers.length > 0) {
      for (const c of p.containers) {
        const kind = c.isMain ? "main" : "sidecar";
        const r = c.restarts != null ? ` · restarts=${c.restarts}` : "";
        const e = c.exitCode != null ? ` · exit=${c.exitCode}` : "";
        const reason = c.reason ? ` · ${c.reason}` : "";
        out += `    ↳ ${c.name} (${kind})  ${c.state}${r}${e}${reason}\n`;
      }
    }
  }
  return out;
}

/* ─── Tool executors ────────────────────────────────────────────────────── */

function execGetNamespaceDetail(namespace: string, ctx: ClusterContext): string {
  const pods = ctx.pods.filter((p) => (p.namespace ?? "default") === namespace);
  const deps = ctx.deployments.filter((d) => (d.namespace ?? "default") === namespace);
  const svcs = ctx.services.filter((s) => (s.namespace ?? "default") === namespace);
  const nsEvents = ctx.events.filter(
    (e) => e.type === "Warning" && (e.namespace ?? "") === namespace,
  );
  const grouped = groupEventsByReason(nsEvents, 15);

  if (pods.length === 0 && deps.length === 0 && svcs.length === 0) {
    return `NAMESPACE: ${namespace}\n  (no resources found — namespace may not exist or context is stale)\n`;
  }

  let out = `NAMESPACE: ${namespace}\n`;

  out += `\nPODS (${pods.length}):\n`;
  out += renderPods(pods);

  if (deps.length > 0) {
    out += `\nDEPLOYMENTS (${deps.length}):\n`;
    for (const d of deps) {
      const [ready, desired] = (d.replicas ?? "0/0").split("/").map(Number);
      const isAnomaly =
        Number.isFinite(ready) && Number.isFinite(desired) && desired > 0 && ready < desired;
      const flag = isAnomaly ? " ⚠" : "";
      out += `  ${d.name}  replicas=${d.replicas ?? "?"}${flag}\n`;
    }
  }

  if (svcs.length > 0) {
    out += `\nSERVICES (${svcs.length}):\n`;
    for (const s of svcs) {
      const t = s.status ?? "ClusterIP";
      const typePart = t !== "ClusterIP" ? `  type=${t}` : "";
      out += `  ${s.name}${typePart}\n`;
    }
  }

  if (grouped.length > 0) {
    out += `\nWARNING EVENTS (${grouped.length} groups):\n`;
    for (const e of grouped) {
      const countPart = (e.count ?? 1) > 1 ? ` ×${e.count}` : "";
      const agePart = e.lastSeen ? ` | ${e.lastSeen} ago` : "";
      out += `  [${e.reason}${countPart}${agePart}] ${e.involvedObject}: ${e.message}\n`;
    }
  }

  return out;
}

function execGetPodDetail(name: string, namespace: string, ctx: ClusterContext): string {
  const pod = ctx.pods.find(
    (p) => p.name === name && (p.namespace ?? "default") === namespace,
  );
  if (!pod) {
    return `POD: ${namespace}/${name}\n  (not found in current context)\n`;
  }

  let out = `POD: ${namespace}/${name}\n`;
  out += `  Status: ${pod.status ?? "?"}\n`;
  out += `  Ready: ${pod.ready ?? "?"}\n`;

  if (pod.containers && pod.containers.length > 0) {
    out += `\nCONTAINERS:\n`;
    for (const c of pod.containers) {
      const kind = c.isMain ? "main" : "sidecar";
      const r = c.restarts != null ? ` · restarts=${c.restarts}` : "";
      const e = c.exitCode != null ? ` · exit=${c.exitCode}` : "";
      const reason = c.reason ? ` · ${c.reason}` : "";
      out += `  ${c.name} (${kind})  ${c.state}${r}${e}${reason}\n`;
    }
  }

  // Related events for this pod
  const podEvents = ctx.events.filter(
    (e) =>
      e.type === "Warning" &&
      (e.involvedObject === `Pod/${name}` || e.involvedObject.endsWith(`/${name}`)),
  );
  const grouped = groupEventsByReason(podEvents, 10);
  if (grouped.length > 0) {
    out += `\nWARNING EVENTS:\n`;
    for (const e of grouped) {
      const countPart = (e.count ?? 1) > 1 ? ` ×${e.count}` : "";
      const agePart = e.lastSeen ? ` | ${e.lastSeen} ago` : "";
      out += `  [${e.reason}${countPart}${agePart}]: ${e.message}\n`;
    }
  }

  return out;
}

function execGetResourceEvents(name: string, namespace: string, ctx: ClusterContext): string {
  const related = ctx.events.filter(
    (e) =>
      e.type === "Warning" &&
      (e.involvedObject.endsWith(`/${name}`) || e.namespace === namespace) &&
      (e.namespace === namespace || e.involvedObject.endsWith(`/${name}`)),
  );

  // Narrow to exact name match first, fall back to namespace-wide
  const exact = related.filter((e) => e.involvedObject.endsWith(`/${name}`));
  const source = exact.length > 0 ? exact : related;

  const grouped = groupEventsByReason(source, 15);
  if (grouped.length === 0) {
    return `EVENTS for ${namespace}/${name}:\n  (no warning events found)\n`;
  }

  let out = `EVENTS for ${namespace}/${name} (${grouped.length} groups):\n`;
  for (const e of grouped) {
    const countPart = (e.count ?? 1) > 1 ? ` ×${e.count}` : "";
    const agePart = e.lastSeen ? ` | ${e.lastSeen} ago` : "";
    out += `  [${e.reason}${countPart}${agePart}] ${e.involvedObject}: ${e.message}\n`;
  }
  return out;
}

function execGetDeploymentDetail(name: string, namespace: string, ctx: ClusterContext): string {
  const dep = ctx.deployments.find(
    (d) => d.name === name && (d.namespace ?? "default") === namespace,
  );
  if (!dep) {
    return `DEPLOYMENT: ${namespace}/${name}\n  (not found in current context)\n`;
  }

  let out = `DEPLOYMENT: ${namespace}/${name}\n`;
  out += `  Replicas: ${dep.replicas ?? "?"}\n`;

  // Pods that likely belong to this deployment (match by name prefix)
  const relatedPods = ctx.pods.filter(
    (p) =>
      (p.namespace ?? "default") === namespace &&
      p.name.startsWith(name),
  );

  if (relatedPods.length > 0) {
    out += `\nPODS (${relatedPods.length} matching name prefix):\n`;
    out += renderPods(relatedPods);
  }

  // Related events
  const depEvents = ctx.events.filter(
    (e) =>
      e.type === "Warning" &&
      (e.namespace ?? "") === namespace &&
      (e.involvedObject.includes(name) || e.involvedObject.startsWith("Deployment/")),
  );
  const grouped = groupEventsByReason(depEvents, 10);
  if (grouped.length > 0) {
    out += `\nWARNING EVENTS:\n`;
    for (const e of grouped) {
      const countPart = (e.count ?? 1) > 1 ? ` ×${e.count}` : "";
      const agePart = e.lastSeen ? ` | ${e.lastSeen} ago` : "";
      out += `  [${e.reason}${countPart}${agePart}] ${e.involvedObject}: ${e.message}\n`;
    }
  }

  return out;
}

function execGetNodes(ctx: ClusterContext): string {
  if (ctx.nodes.length === 0) {
    return `NODES:\n  (none found in current context)\n`;
  }
  let out = `NODES (${ctx.nodes.length}):\n`;
  for (const n of ctx.nodes) {
    const flag = (n.status ?? "") !== "Ready" ? " ⚠" : "";
    out += `  ${n.name}  [${n.status ?? "?"}]${flag}\n`;
  }
  return out;
}

/* ─── Public dispatcher ─────────────────────────────────────────────────── */

/**
 * Execute a named K8s tool against the live ClusterContext.
 * Returns a compact plain-text result suitable for an Ollama tool-result message.
 * Never performs API calls — operates entirely on in-memory data.
 */
export function executeK8sTool(
  name: string,
  args: Record<string, any>,
  ctx: ClusterContext,
): string {
  try {
    switch (name) {
      case "get_namespace_detail":
        return execGetNamespaceDetail(String(args.namespace ?? ""), ctx);
      case "get_pod_detail":
        return execGetPodDetail(String(args.name ?? ""), String(args.namespace ?? ""), ctx);
      case "get_resource_events":
        return execGetResourceEvents(String(args.name ?? ""), String(args.namespace ?? ""), ctx);
      case "get_deployment_detail":
        return execGetDeploymentDetail(String(args.name ?? ""), String(args.namespace ?? ""), ctx);
      case "get_nodes":
        return execGetNodes(ctx);
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e: any) {
    return `Tool error (${name}): ${e?.message ?? String(e)}`;
  }
}
