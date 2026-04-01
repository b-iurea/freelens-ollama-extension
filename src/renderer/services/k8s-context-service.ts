/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * Kubernetes Context Service - gathers cluster information
 * using the Freelens extensions API
 */

import { Renderer } from "@freelensapp/extensions";
import type {
  ClusterContext,
} from "../../common/types";

/**
 * Try multiple paths to find a K8s resource store.
 *
 * Freelens 1.4+ exposes KubeObject subclasses (Pod, Deployment …) and
 * per-resource API singletons (podsApi, deploymentApi …) but NOT the old
 * named stores (podsStore, deploymentStore).  The stores live inside
 * `apiManager` and can be retrieved via `apiManager.getStore(apiInstance)`.
 *
 * Lookup order:
 *   1. `api.apiManager.getStore(api.<lowerKind>Api)`   — Freelens 1.4+
 *   2. `api.<pluralKey>Store`                          — legacy (Lens 5 / early Freelens)
 *   3. `api.<KindKey>.store`                           — alternate legacy
 *   4. `api.storesManager.getStore(…)`                 — future-proofing
 */
function resolveStore(pluralKey: string, kindKey: string): any {
  const api: any = Renderer.K8sApi;
  if (!api) return null;

  // Map from our key to the *Api singleton name on Renderer.K8sApi
  const apiInstanceMap: Record<string, string> = {
    pods:        "podsApi",
    deployments: "deploymentApi",
    services:    "serviceApi",
    nodes:       "nodesApi",
    events:      "eventApi",
  };

  // Strategy 1 – apiManager.getStore(apiInstance)  ← works in Freelens 1.4+
  if (api.apiManager) {
    try {
      const apiName = apiInstanceMap[pluralKey];
      const apiInstance = apiName ? api[apiName] : undefined;
      if (apiInstance) {
        const store = api.apiManager.getStore(apiInstance);
        if (store) {
          console.log(`[K8s SRE] resolveStore(${pluralKey}): found via apiManager.getStore(${apiName})`);
          return store;
        }
      }
    } catch (e) {
      console.warn(`[K8s SRE] resolveStore(${pluralKey}): apiManager.getStore failed:`, e);
    }

    // Also try getStore with the KubeApi class itself
    try {
      const KubeClass = api[kindKey]; // e.g. api.Pod (constructor/class)
      if (KubeClass) {
        const store = api.apiManager.getStore(KubeClass);
        if (store) {
          console.log(`[K8s SRE] resolveStore(${pluralKey}): found via apiManager.getStore(${kindKey})`);
          return store;
        }
      }
    } catch { /* ignore */ }
  }

  // Strategy 2 – direct named store (e.g. api.podsStore) — legacy
  const legacyMap: Record<string, string> = {
    pods: "podsStore",
    deployments: "deploymentStore",
    services: "serviceStore",
    nodes: "nodesStore",
    events: "eventStore",
  };
  const directName = legacyMap[pluralKey];
  if (directName && api[directName]) {
    console.log(`[K8s SRE] resolveStore(${pluralKey}): found via api.${directName}`);
    return api[directName];
  }

  // Strategy 3 – Kind.store (e.g. api.Pod.store)
  if (api[kindKey]?.store) {
    console.log(`[K8s SRE] resolveStore(${pluralKey}): found via api.${kindKey}.store`);
    return api[kindKey].store;
  }

  // Strategy 4 – storesManager (future)
  if (api.storesManager) {
    try {
      const store = api.storesManager.getStore?.(pluralKey) || api.storesManager.getStore?.(kindKey);
      if (store) {
        console.log(`[K8s SRE] resolveStore(${pluralKey}): found via storesManager`);
        return store;
      }
    } catch { /* ignore */ }
  }

  console.warn(`[K8s SRE] resolveStore(${pluralKey}): NOT found via any strategy`);
  return null;
}

export class K8sContextService {
  /**
   * Gather the current cluster context visible in Freelens.
   *
   * Uses multiple lookup strategies for each resource kind because the
   * Freelens extensions API surface varies between versions and the stores
   * may live under different paths (e.g. `Renderer.K8sApi.podsStore` vs
   * `Renderer.K8sApi.Pod.store`).  Every access is wrapped in try/catch
   * so a single miss never breaks the whole context.
   */
  static async gatherContext(): Promise<ClusterContext> {
    const context: ClusterContext = {
      clusterName: "Unknown",
      namespace: "default",
      pods: [],
      deployments: [],
      services: [],
      nodes: [],
      events: [],
    };

    /* ── DEBUG: dump Renderer.K8sApi shape ── */
    try {
      const api: any = Renderer.K8sApi;
      if (api) {
        const topKeys = Object.keys(api).sort();
        console.log("[K8s SRE] Renderer.K8sApi keys (" + topKeys.length + "):", topKeys.join(", "));

        // Check each known store path
        for (const name of ["podsStore", "deploymentStore", "serviceStore", "nodesStore", "eventStore"]) {
          const val = api[name];
          console.log(`[K8s SRE]   api.${name} →`, val ? `exists (items: ${val.items?.length ?? "?"})` : "undefined");
        }
        // Check kind-based access
        for (const kind of ["Pod", "Deployment", "Service", "Node", "Event"]) {
          const val = api[kind];
          console.log(`[K8s SRE]   api.${kind} →`, val ? (val.store ? `has .store (items: ${val.store.items?.length ?? "?"})` : `exists (type: ${typeof val}, keys: ${Object.keys(val).join(",")})`) : "undefined");
        }
        // Check storesManager / apiManager
        console.log("[K8s SRE]   api.storesManager →", api.storesManager ? "exists" : "undefined");
        console.log("[K8s SRE]   api.apiManager →", api.apiManager ? "exists" : "undefined");
        if (api.apiManager) {
          const amKeys = Object.keys(api.apiManager).sort();
          console.log("[K8s SRE]   api.apiManager keys:", amKeys.join(", "));
          // Try getStore with each known *Api instance
          for (const apiName of ["podsApi", "deploymentApi", "serviceApi", "nodesApi", "eventApi"]) {
            try {
              const apiInst = api[apiName];
              if (apiInst) {
                const store = api.apiManager.getStore(apiInst);
                console.log(`[K8s SRE]   apiManager.getStore(${apiName}) →`, store ? `store (items: ${store.items?.length ?? "?"})` : "null/undefined");
              } else {
                console.log(`[K8s SRE]   api.${apiName} → undefined`);
              }
            } catch (e: any) {
              console.log(`[K8s SRE]   apiManager.getStore(${apiName}) threw:`, e.message);
            }
          }
        }
        console.log("[K8s SRE]   api.forCluster →", typeof api.forCluster);
        console.log("[K8s SRE]   api.forRemoteCluster →", typeof api.forRemoteCluster);
      } else {
        console.warn("[K8s SRE] Renderer.K8sApi is FALSY:", api);
      }
      console.log("[K8s SRE] Renderer.Catalog →", Renderer.Catalog ? "exists" : "undefined");
      console.log("[K8s SRE] Renderer.Catalog.catalogEntities →", (Renderer.Catalog as any)?.catalogEntities ? "exists" : "undefined");
    } catch (e) {
      console.warn("[K8s SRE] DEBUG dump failed:", e);
    }

    /* ── Cluster name ── */
    try {
      const cluster = Renderer.Catalog?.catalogEntities?.activeEntity;
      if (cluster) {
        context.clusterName = (cluster as any).metadata?.name || "Unknown";
      }
      console.log("[K8s SRE] Cluster name:", context.clusterName);
    } catch (e) {
      console.warn("[K8s SRE] Could not get cluster name:", e);
    }

    /* ── Pods ── */
    try {
      const podStore = resolveStore("pods", "Pod");
      if (podStore) {
        const pods = podStore.items || [];
        console.log("[K8s SRE] Pod store found, items:", pods.length);
        context.pods = pods.slice(0, 100).map((pod: any) => ({
          name: pod.getName?.() || pod.metadata?.name || "unknown",
          namespace: pod.getNs?.() || pod.metadata?.namespace || "default",
          status: pod.getStatusMessage?.() || getPhase(pod),
          ready: getReadyCount(pod),
          labels: pod.metadata?.labels,
        }));
      } else {
        console.warn("[K8s SRE] Pod store NOT available – tried podsStore, storesManager, Pod.store");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get pods:", e);
    }

    /* ── Deployments ── */
    try {
      const deploymentStore = resolveStore("deployments", "Deployment");
      if (deploymentStore) {
        const deployments = deploymentStore.items || [];
        console.log("[K8s SRE] Deployment store found, items:", deployments.length);
        context.deployments = deployments.slice(0, 50).map((dep: any) => ({
          name: dep.getName?.() || dep.metadata?.name || "unknown",
          namespace: dep.getNs?.() || dep.metadata?.namespace || "default",
          replicas: `${dep.status?.readyReplicas || 0}/${dep.spec?.replicas || 0}`,
          labels: dep.metadata?.labels,
        }));
      } else {
        console.warn("[K8s SRE] Deployment store NOT available");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get deployments:", e);
    }

    /* ── Services ── */
    try {
      const serviceStore = resolveStore("services", "Service");
      if (serviceStore) {
        const services = serviceStore.items || [];
        console.log("[K8s SRE] Service store found, items:", services.length);
        context.services = services.slice(0, 50).map((svc: any) => ({
          name: svc.getName?.() || svc.metadata?.name || "unknown",
          namespace: svc.getNs?.() || svc.metadata?.namespace || "default",
          status: svc.spec?.type || "ClusterIP",
          labels: svc.metadata?.labels,
        }));
      } else {
        console.warn("[K8s SRE] Service store NOT available");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get services:", e);
    }

    /* ── Nodes ── */
    try {
      const nodeStore = resolveStore("nodes", "Node");
      if (nodeStore) {
        const nodes = nodeStore.items || [];
        console.log("[K8s SRE] Node store found, items:", nodes.length);
        context.nodes = nodes.map((node: any) => ({
          name: node.getName?.() || node.metadata?.name || "unknown",
          status: getNodeStatus(node),
          labels: node.metadata?.labels,
        }));
      } else {
        console.warn("[K8s SRE] Node store NOT available");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get nodes:", e);
    }

    /* ── Events ── */
    try {
      // In Freelens 1.4+ events are under "KubeEvent", not "Event"
      let eventStore = resolveStore("events", "KubeEvent");
      if (!eventStore) eventStore = resolveStore("events", "Event");
      if (eventStore) {
        const events = eventStore.items || [];
        console.log("[K8s SRE] Event store found, items:", events.length);
        // Get last 30 events, sorted by most recent
        const sortedEvents = [...events]
          .sort((a: any, b: any) => {
            const aTime = new Date(a.metadata?.creationTimestamp || 0).getTime();
            const bTime = new Date(b.metadata?.creationTimestamp || 0).getTime();
            return bTime - aTime;
          })
          .slice(0, 30);

        context.events = sortedEvents.map((event: any) => ({
          type: event.type || "Normal",
          reason: event.reason || "Unknown",
          message: event.message || "",
          involvedObject: `${event.involvedObject?.kind || "?"}/${event.involvedObject?.name || "?"}`,
          age: event.metadata?.creationTimestamp,
        }));
      } else {
        console.warn("[K8s SRE] Event store NOT available");
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get events:", e);
    }

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

function getPhase(pod: any): string {
  try {
    return pod.status?.phase || "Unknown";
  } catch {
    return "Unknown";
  }
}

function getReadyCount(pod: any): string {
  try {
    const containers = pod.status?.containerStatuses || [];
    const ready = containers.filter((c: any) => c.ready).length;
    return `${ready}/${containers.length}`;
  } catch {
    return "?/?";
  }
}

function getNodeStatus(node: any): string {
  try {
    const conditions = node.status?.conditions || [];
    const readyCondition = conditions.find((c: any) => c.type === "Ready");
    return readyCondition?.status === "True" ? "Ready" : "NotReady";
  } catch {
    return "Unknown";
  }
}
