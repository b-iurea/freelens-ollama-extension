/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Kubernetes Context Service - gathers cluster information
 * using the Freelens extensions API.
 *
 * Freelens stores are LAZY — they only hold resources the user has browsed.
 * To get a full cluster view we call `KubeApi.list()` directly, which
 * queries the K8s API server for ALL resources across all namespaces.
 * The store is used as a fallback only.
 */

import { Renderer } from "@freelensapp/extensions";
import type {
  ClusterContext,
} from "../../common/types";

/* ─── helpers ─── */

/** Safely get the K8sApi bag */
function api(): any {
  return Renderer.K8sApi as any;
}

/**
 * Fetch the full list of a resource kind via KubeApi.list().
 * Returns raw JSON items array or null on failure.
 */
async function listViaApi(apiInstance: any, namespace?: string): Promise<any[] | null> {
  if (!apiInstance) return null;
  try {
    // KubeApi.list() returns a string (JSON text) or parsed object depending on version
    const result = await apiInstance.list({ namespace });
    // Some Freelens versions return the raw string, others the parsed list
    if (typeof result === "string") {
      const parsed = JSON.parse(result);
      return parsed?.items ?? parsed ?? null;
    }
    // Already an array of KubeObjects
    if (Array.isArray(result)) return result;
    // Or a list wrapper { items: [...] }
    if (result?.items && Array.isArray(result.items)) return result.items;
    return null;
  } catch (e: any) {
    console.warn("[K8s SRE] listViaApi failed:", e?.message ?? e);
    return null;
  }
}

/**
 * Fallback: get items from the in-memory store via apiManager.
 */
function getStoreItems(pluralKey: string): any[] | null {
  const a = api();
  if (!a?.apiManager) return null;

  const apiMap: Record<string, string> = {
    pods:        "podsApi",
    deployments: "deploymentApi",
    services:    "serviceApi",
    nodes:       "nodesApi",
    events:      "eventApi",
  };
  const apiName = apiMap[pluralKey];
  if (!apiName || !a[apiName]) return null;

  try {
    const store = a.apiManager.getStore(a[apiName]);
    if (store?.items?.length) return store.items;
  } catch { /* ignore */ }
  return null;
}

/**
 * Strip noisy labels from K8s objects for token-efficient AI context.
 * Keeps only short, meaningful labels; drops hashes, helm internals, etc.
 */
function cleanLabels(obj: any): Record<string, string> | undefined {
  const labels = obj?.metadata?.labels ?? obj?.labels;
  if (!labels || typeof labels !== "object") return undefined;

  // Label keys that are usually just noise for an AI summary
  const SKIP_KEYS = new Set([
    "pod-template-hash",
    "controller-revision-hash",
    "chart",
    "helm.sh/chart",
    "app.kubernetes.io/managed-by",
    "app.kubernetes.io/part-of",
  ]);

  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v !== "string") continue;
    if (v.length > 63) continue;          // overly long values
    if (SKIP_KEYS.has(k)) continue;       // known noise
    clean[k] = v;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/* ── Per-resource-kind limits (keeps prompt under ~4k tokens) ── */
const MAX_PODS = 120;
const MAX_DEPLOYMENTS = 80;
const MAX_SERVICES = 80;
const MAX_EVENTS = 40;

export class K8sContextService {
  /**
   * Gather the current cluster context.
   *
   * @param filterNamespace  If set, only namespaced resources in this NS are
   *                         returned. Cluster-scoped resources (nodes) and the
   *                         namespace list are always fetched in full.
   *                         Pass `undefined` for all namespaces (with limits).
   */
  static async gatherContext(filterNamespace?: string): Promise<ClusterContext> {
    const context: ClusterContext = {
      clusterName: "Unknown",
      namespace: "default",
      namespaces: [],
      pods: [],
      deployments: [],
      services: [],
      nodes: [],
      events: [],
    };

    const a = api();
    if (!a) {
      console.warn("[K8s SRE] Renderer.K8sApi not available");
      return context;
    }

    /* ── Cluster name ── */
    try {
      const cluster = Renderer.Catalog?.catalogEntities?.activeEntity;
      if (cluster) {
        context.clusterName = (cluster as any).metadata?.name || "Unknown";
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get cluster name:", e);
    }

    /* ── helper: filter by namespace if a filter is active ── */
    const nsFilter = (items: any[] | null): any[] | null => {
      if (!items || !filterNamespace) return items;
      return items.filter((item: any) => {
        const ns = item.getNs?.() ?? item.metadata?.namespace ?? item.namespace;
        return ns === filterNamespace;
      });
    };

    /* ── Pods ── */
    try {
      let pods = await listViaApi(a.podsApi, filterNamespace);
      if (!pods?.length) {
        pods = nsFilter(getStoreItems("pods"));
        if (pods?.length) console.log("[K8s SRE] Pods: fell back to store");
      }
      if (pods?.length) {
        console.log("[K8s SRE] Pods: total", pods.length, filterNamespace ? `(ns=${filterNamespace})` : "(all)");
        context.pods = pods.slice(0, MAX_PODS).map((pod: any) => {
          const meta = pod.metadata ?? pod;
          return {
            name: pod.getName?.() ?? meta.name ?? "unknown",
            namespace: pod.getNs?.() ?? meta.namespace ?? "default",
            status: pod.getStatusMessage?.() ?? pod.status?.phase ?? "Unknown",
            ready: getReadyCount(pod),
            labels: cleanLabels(pod),
          };
        });
      } else {
        console.warn("[K8s SRE] Pods: none found");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get pods:", e);
    }

    /* ── Deployments ── */
    try {
      let deps = await listViaApi(a.deploymentApi, filterNamespace);
      if (!deps?.length) {
        deps = nsFilter(getStoreItems("deployments"));
        if (deps?.length) console.log("[K8s SRE] Deployments: fell back to store");
      }
      if (deps?.length) {
        console.log("[K8s SRE] Deployments: total", deps.length, filterNamespace ? `(ns=${filterNamespace})` : "(all)");
        context.deployments = deps.slice(0, MAX_DEPLOYMENTS).map((dep: any) => {
          const meta = dep.metadata ?? dep;
          return {
            name: dep.getName?.() ?? meta.name ?? "unknown",
            namespace: dep.getNs?.() ?? meta.namespace ?? "default",
            replicas: `${dep.status?.readyReplicas ?? 0}/${dep.spec?.replicas ?? 0}`,
            labels: cleanLabels(dep),
          };
        });
      } else {
        console.warn("[K8s SRE] Deployments: none found");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get deployments:", e);
    }

    /* ── Services ── */
    try {
      let svcs = await listViaApi(a.serviceApi, filterNamespace);
      if (!svcs?.length) {
        svcs = nsFilter(getStoreItems("services"));
        if (svcs?.length) console.log("[K8s SRE] Services: fell back to store");
      }
      if (svcs?.length) {
        console.log("[K8s SRE] Services: total", svcs.length, filterNamespace ? `(ns=${filterNamespace})` : "(all)");
        context.services = svcs.slice(0, MAX_SERVICES).map((svc: any) => {
          const meta = svc.metadata ?? svc;
          return {
            name: svc.getName?.() ?? meta.name ?? "unknown",
            namespace: svc.getNs?.() ?? meta.namespace ?? "default",
            status: svc.spec?.type ?? "ClusterIP",
            labels: cleanLabels(svc),
          };
        });
      } else {
        console.warn("[K8s SRE] Services: none found");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get services:", e);
    }

    /* ── Nodes (always cluster-scoped, no namespace filter) ── */
    try {
      let nodes = await listViaApi(a.nodesApi);
      if (!nodes?.length) {
        nodes = getStoreItems("nodes");
        if (nodes?.length) console.log("[K8s SRE] Nodes: fell back to store");
      }
      if (nodes?.length) {
        console.log("[K8s SRE] Nodes: total", nodes.length);
        context.nodes = nodes.map((node: any) => {
          const meta = node.metadata ?? node;
          return {
            name: node.getName?.() ?? meta.name ?? "unknown",
            status: getNodeStatus(node),
            labels: cleanLabels(node),
          };
        });
      } else {
        console.warn("[K8s SRE] Nodes: none found");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get nodes:", e);
    }

    /* ── Events (filtered by namespace if applicable) ── */
    try {
      let evts = await listViaApi(a.eventApi, filterNamespace);
      if (!evts?.length) {
        evts = nsFilter(getStoreItems("events"));
        if (evts?.length) console.log("[K8s SRE] Events: fell back to store");
      }
      if (evts?.length) {
        console.log("[K8s SRE] Events: total", evts.length, filterNamespace ? `(ns=${filterNamespace})` : "(all)");
        const sorted = [...evts]
          .sort((x: any, y: any) => {
            const ta = new Date((x.metadata ?? x).creationTimestamp || 0).getTime();
            const tb = new Date((y.metadata ?? y).creationTimestamp || 0).getTime();
            return tb - ta;
          })
          .slice(0, MAX_EVENTS);

        context.events = sorted.map((evt: any) => ({
          type: evt.type ?? "Normal",
          reason: evt.reason ?? "Unknown",
          message: (evt.message ?? "").slice(0, 200),  // truncate long event messages
          involvedObject: `${evt.involvedObject?.kind ?? "?"}/${evt.involvedObject?.name ?? "?"}`,
          age: (evt.metadata ?? evt).creationTimestamp,
        }));
      } else {
        console.warn("[K8s SRE] Events: none found");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get events:", e);
    }

    /* ── Namespaces (always full list, regardless of filter) ── */
    try {
      const nsList = await listViaApi(a.namespacesApi);
      if (nsList?.length) {
        console.log("[K8s SRE] Namespaces: total", nsList.length);
        context.namespaces = nsList.map((ns: any) => {
          const meta = ns.metadata ?? ns;
          return meta.name ?? "unknown";
        }).sort();
        context.namespace = filterNamespace
          ? filterNamespace
          : `all (${nsList.length} namespaces)`;
      }
    } catch { /* ignore */ }

    console.log(
      "[K8s SRE] Context gathered →",
      `cluster=${context.clusterName}`,
      `pods=${context.pods.length}`,
      `deployments=${context.deployments.length}`,
      `services=${context.services.length}`,
      `nodes=${context.nodes.length}`,
      `events=${context.events.length}`,
    );

    return context;
  }
}

function getReadyCount(pod: any): string {
  try {
    const containers = pod.status?.containerStatuses ?? [];
    const ready = containers.filter((c: any) => c.ready).length;
    return `${ready}/${containers.length}`;
  } catch {
    return "?/?";
  }
}

function getNodeStatus(node: any): string {
  try {
    const conditions = node.status?.conditions ?? [];
    const readyCondition = conditions.find((c: any) => c.type === "Ready");
    return readyCondition?.status === "True" ? "Ready" : "NotReady";
  } catch {
    return "Unknown";
  }
}
