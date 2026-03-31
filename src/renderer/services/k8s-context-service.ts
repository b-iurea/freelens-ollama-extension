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
  K8sEventSummary,
  K8sResourceSummary,
} from "../../common/types";

export class K8sContextService {
  /**
   * Gather the current cluster context visible in Freelens
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

    try {
      // Get the active cluster
      const cluster = Renderer.Catalog?.catalogEntities?.activeEntity;
      if (cluster) {
        context.clusterName = (cluster as any).metadata?.name || "Unknown";
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get cluster name:", e);
    }

    try {
      // Use the K8s API stores from the extensions API
      const podStore = Renderer.K8sApi?.podsStore;
      if (podStore) {
        const pods = podStore.items || [];
        context.pods = pods.slice(0, 100).map((pod: any) => ({
          name: pod.getName?.() || pod.metadata?.name || "unknown",
          namespace: pod.getNs?.() || pod.metadata?.namespace || "default",
          status: pod.getStatusMessage?.() || getPhase(pod),
          ready: getReadyCount(pod),
          labels: pod.metadata?.labels,
        }));
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get pods:", e);
    }

    try {
      const deploymentStore = Renderer.K8sApi?.deploymentStore;
      if (deploymentStore) {
        const deployments = deploymentStore.items || [];
        context.deployments = deployments.slice(0, 50).map((dep: any) => ({
          name: dep.getName?.() || dep.metadata?.name || "unknown",
          namespace: dep.getNs?.() || dep.metadata?.namespace || "default",
          replicas: `${dep.status?.readyReplicas || 0}/${dep.spec?.replicas || 0}`,
          labels: dep.metadata?.labels,
        }));
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get deployments:", e);
    }

    try {
      const serviceStore = Renderer.K8sApi?.serviceStore;
      if (serviceStore) {
        const services = serviceStore.items || [];
        context.services = services.slice(0, 50).map((svc: any) => ({
          name: svc.getName?.() || svc.metadata?.name || "unknown",
          namespace: svc.getNs?.() || svc.metadata?.namespace || "default",
          status: svc.spec?.type || "ClusterIP",
          labels: svc.metadata?.labels,
        }));
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get services:", e);
    }

    try {
      const nodeStore = Renderer.K8sApi?.nodesStore;
      if (nodeStore) {
        const nodes = nodeStore.items || [];
        context.nodes = nodes.map((node: any) => ({
          name: node.getName?.() || node.metadata?.name || "unknown",
          status: getNodeStatus(node),
          labels: node.metadata?.labels,
        }));
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get nodes:", e);
    }

    try {
      const eventStore = Renderer.K8sApi?.eventStore;
      if (eventStore) {
        const events = eventStore.items || [];
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
      }
    } catch (e) {
      console.warn("[K8s SRE] Could not get events:", e);
    }

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
