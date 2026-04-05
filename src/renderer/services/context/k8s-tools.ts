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
import { fetchPodLogs } from "../k8s-context-service";

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
  {
    type: "function",
    function: {
      name: "get_pod_logs",
      description:
        "Fetch the last 30 log lines from a specific container in a pod. " +
        "IMPORTANT: This tool contains sensitive runtime data. You MUST explain why you need the logs " +
        "before calling this tool. State what you have already found and what you expect the logs to confirm. " +
        "Design your analysis to be useful even if the user denies the request. " +
        "Only call this when you have already analyzed all context (owner, resources, volumes, missing refs) " +
        "and the logs are the final missing piece.",
      parameters: {
        type: "object",
        required: ["name", "namespace", "container"],
        properties: {
          name: { type: "string", description: "Pod name." },
          namespace: { type: "string", description: "Pod namespace." },
          container: { type: "string", description: "Container name within the pod." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_resource_chain",
      description:
        "Get the full cause/effect relationship chain for an anomalous pod: owner controller, " +
        "volumes (PVC status), missing Secrets/ConfigMaps, HPA, service endpoint count, " +
        "and Ingress chain. Use this when you see an anomalous pod and want to understand " +
        "what upstream or downstream resources are involved.",
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
      name: "list_resources",
      description:
        "List all Kubernetes resources of a specific kind across the cluster, " +
        "optionally filtered to a single namespace. " +
        "Supported kinds: pods, deployments, services, nodes, namespaces. " +
        "For pods, the response includes each pod's container names so you can use them with get_pod_logs. " +
        "Use this for full inventory when the system context only shows a summary.",
      parameters: {
        type: "object",
        required: ["kind"],
        properties: {
          kind: {
            type: "string",
            description: "Resource kind: pods | deployments | services | nodes | namespaces",
          },
          namespace: {
            type: "string",
            description: "Optional namespace filter. Omit to list across all namespaces.",
          },
        },
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

function execGetResourceChain(name: string, namespace: string, ctx: ClusterContext): string {
  const pod = ctx.pods.find(
    (p) => p.name === name && (p.namespace ?? "default") === namespace,
  );
  if (!pod) {
    return `RESOURCE CHAIN: ${namespace}/${name}\n  (pod not found in current context)\n`;
  }

  let out = `RESOURCE CHAIN: ${namespace}/${name}  ${pod.status ?? "?"}\n`;

  // Richer per-container fields
  if (pod.node) out += `  node: ${pod.node}\n`;
  if (pod.containers && pod.containers.length > 0) {
    out += `\nCONTAINERS:\n`;
    for (const c of pod.containers) {
      const kind = c.isMain ? "main" : "sidecar";
      const r = c.restarts != null ? ` · restarts=${c.restarts}` : "";
      const e = c.exitCode != null ? ` · exit=${c.exitCode}` : "";
      const reason = c.reason ? ` · ${c.reason}` : "";
      out += `  ${c.name} (${kind})  ${c.state}${r}${e}${reason}\n`;
      if (c.image) out += `    image: ${c.image}\n`;
      if (c.resources) {
        const { reqCpu, reqMem, limCpu, limMem } = c.resources;
        const req = [reqCpu && `cpu:${reqCpu}`, reqMem && `mem:${reqMem}`].filter(Boolean).join(",");
        const lim = [limCpu && `cpu:${limCpu}`, limMem && `mem:${limMem}`].filter(Boolean).join(",");
        if (req || lim) out += `    resources: req=${req || "?"} lim=${lim || "?"}\n`;
      }
      if (c.probes) {
        const parts = [
          c.probes.liveness && `liveness=${c.probes.liveness}`,
          c.probes.readiness && `readiness=${c.probes.readiness}`,
        ].filter(Boolean).join(" ");
        if (parts) out += `    probes: ${parts}\n`;
      }
    }
  }

  const rel = pod.relations;
  if (!rel) {
    out += `\n  (relationship data not available — context may be stale)\n`;
    return out;
  }

  // Owner controller
  if (rel.ownerRef) {
    const r = rel.ownerRef;
    const repPart = r.replicas ? `  replicas=${r.replicas}` : "";
    const stratPart = r.strategy ? `  strategy=${r.strategy}` : "";
    const [ready, desired] = (r.replicas ?? "1/1").split("/").map(Number);
    const flag = Number.isFinite(ready) && Number.isFinite(desired) && desired > 0 && ready < desired ? " ⚠" : "";
    out += `\nOWNER: ${r.kind}/${r.name}${repPart}${stratPart}${flag}\n`;
  }

  // HPA
  if (rel.hpa) {
    const h = rel.hpa;
    const cpuPart = h.cpuPercent != null ? `  CPU:${h.cpuPercent}%${h.cpuPercent >= 80 ? " ⚠" : ""}` : "";
    out += `HPA: ${h.name}  min=${h.minReplicas} max=${h.maxReplicas} current=${h.currentReplicas}${cpuPart}\n`;
  }

  // PVCs
  if (rel.pvcs.length > 0) {
    out += `\nVOLUMES:\n`;
    for (const pvc of rel.pvcs) {
      const flag = pvc.phase !== "Bound" ? " ⚠" : " ✓";
      out += `  pvc/${pvc.name}  [${pvc.phase}]${flag}\n`;
    }
  }

  // Present refs
  if (rel.presentRefs.length > 0) {
    out += `\nPRESENT REFS:\n`;
    for (const r of rel.presentRefs) {
      out += `  ${r.kind}/${r.name}  [${r.refType}] ✓\n`;
    }
  }

  // Missing refs — the most actionable info
  if (rel.missingRefs.length > 0) {
    out += `\nMISSING REFS ⚠:\n`;
    for (const r of rel.missingRefs) {
      out += `  ${r.kind}/${r.name}  [${r.refType}] MISSING ⚠\n`;
    }
  }

  // Service endpoints
  if (rel.serviceEndpoints && rel.serviceEndpoints.length > 0) {
    out += `\nSERVICES:\n`;
    for (const s of rel.serviceEndpoints) {
      out += `  ${s.serviceName} → ${s.endpointCount === 0 ? "0 endpoints ⚠" : `${s.endpointCount} endpoints`}\n`;
    }
  }

  // Ingress chain
  if (rel.ingressChain && rel.ingressChain.length > 0) {
    out += `\nINGRESS:\n`;
    for (const i of rel.ingressChain) {
      out += `  ${i.ingressName} → ${i.serviceName}\n`;
    }
  }

  // Helm release
  if (rel.helmRelease) {
    out += `\nHELM RELEASE: ${rel.helmRelease}\n`;
  }

  return out;
}

function execListResources(kind: string, namespace: string | undefined, ctx: ClusterContext): string {
  const ns = namespace?.trim() || undefined;
  const k = kind.trim().toLowerCase();

  switch (k) {
    case "pods": {
      const items = ns ? ctx.pods.filter((p) => (p.namespace ?? "default") === ns) : ctx.pods;
      if (!items.length) return `PODS${ns ? ` in ${ns}` : ""}:\n  (none)\n`;
      let out = `PODS${ns ? ` in ${ns}` : ""} (${items.length}):\n`;
      for (const p of items) {
        const prefix = ns ? "" : `${p.namespace ?? "default"}/`;
        const cNames = p.containers?.map((c) => c.name).join(", ");
        const flag = (p.status ?? "") !== "Running" && (p.status ?? "") !== "Completed" && (p.status ?? "") !== "" ? " ⚠" : "";
        out += `  ${prefix}${p.name}  ${p.status ?? "?"}  ready=${p.ready ?? "?"}${cNames ? `  containers=[${cNames}]` : ""}${flag}\n`;
      }
      return out;
    }
    case "deployments": {
      const items = ns ? ctx.deployments.filter((d) => (d.namespace ?? "default") === ns) : ctx.deployments;
      if (!items.length) return `DEPLOYMENTS${ns ? ` in ${ns}` : ""}:\n  (none)\n`;
      let out = `DEPLOYMENTS${ns ? ` in ${ns}` : ""} (${items.length}):\n`;
      for (const d of items) {
        const prefix = ns ? "" : `${d.namespace ?? "default"}/`;
        const [ready, desired] = (d.replicas ?? "0/0").split("/").map(Number);
        const flag = Number.isFinite(ready) && Number.isFinite(desired) && desired > 0 && ready < desired ? " ⚠" : "";
        out += `  ${prefix}${d.name}  replicas=${d.replicas ?? "?"}${flag}\n`;
      }
      return out;
    }
    case "services": {
      const items = ns ? ctx.services.filter((s) => (s.namespace ?? "default") === ns) : ctx.services;
      if (!items.length) return `SERVICES${ns ? ` in ${ns}` : ""}:\n  (none)\n`;
      let out = `SERVICES${ns ? ` in ${ns}` : ""} (${items.length}):\n`;
      for (const s of items) {
        const prefix = ns ? "" : `${s.namespace ?? "default"}/`;
        out += `  ${prefix}${s.name}  type=${s.status ?? "ClusterIP"}\n`;
      }
      return out;
    }
    case "nodes":
      return execGetNodes(ctx);
    case "namespaces": {
      if (!ctx.namespaces.length) return "NAMESPACES:\n  (none)\n";
      let out = `NAMESPACES (${ctx.namespaces.length}):\n`;
      for (const name of ctx.namespaces) out += `  ${name}\n`;
      return out;
    }
    default:
      return `list_resources: unsupported kind "${kind}". Supported: pods, deployments, services, nodes, namespaces`;
  }
}

/**
 * Execute a named K8s tool against the live ClusterContext.
 * Returns a compact plain-text result suitable for an Ollama tool-result message.
 *
 * NOTE: `get_pod_logs` is intentionally NOT handled here — it requires async
 * execution and human-in-the-loop approval. It is intercepted by chat-store.ts
 * before reaching this function.
 * Never performs additional API calls — operates entirely on in-memory data,
 * except for `get_pod_logs` which is handled externally.
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
      case "get_resource_chain":
        return execGetResourceChain(String(args.name ?? ""), String(args.namespace ?? ""), ctx);
      case "list_resources":
        return execListResources(String(args.kind ?? ""), args.namespace ? String(args.namespace) : undefined, ctx);
      case "get_pod_logs":
        // Should have been intercepted by chat-store HiL flow before reaching here
        return `get_pod_logs: requires user approval — not executed via sync dispatcher`;
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e: any) {
    return `Tool error (${name}): ${e?.message ?? String(e)}`;
  }
}

/**
 * Execute `get_pod_logs` asynchronously after user approval.
 * Separated from executeK8sTool because it requires an API call and async/await.
 */
export async function executePodLogsApproved(
  args: Record<string, string>,
  ctx: ClusterContext,
): Promise<string> {
  const { name, namespace, container } = args;
  if (!name || !namespace || !container) {
    return `get_pod_logs: missing required args (name=${name}, namespace=${namespace}, container=${container})`;
  }
  const pod = ctx.pods.find(
    (p) => p.name === name && (p.namespace ?? "default") === namespace,
  );
  if (!pod) {
    return `get_pod_logs: pod ${namespace}/${name} not found in context`;
  }
  try {
    const { Renderer } = await import("@freelensapp/extensions");
    const podsApi = (Renderer.K8sApi as any)?.podsApi;
    if (!podsApi) return `get_pod_logs: podsApi not available`;
    const logs = await fetchPodLogs(podsApi, name, namespace, container);
    if (!logs) return `get_pod_logs: no logs available for ${namespace}/${name}/${container}`;
    return `LOGS [${namespace}/${name}/${container}]:\n${logs}`;
  } catch (e: any) {
    return `get_pod_logs error: ${e?.message ?? String(e)}`;
  }
}
