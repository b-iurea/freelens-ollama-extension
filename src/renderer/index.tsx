/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 */

import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";
import { SreAssistantPage } from "./pages/sre-assistant-page";
import { SreIcon } from "./icons/sre-icon";
import { SrePreferencesInput, SrePreferencesHint } from "./preferences/sre-preferences";
import { ChatStore } from "./stores/chat-store";
import { WorkloadAnalysisMenu } from "./components/workload-analysis-menu";
import { WorkloadAnalysisDetail } from "./components/workload-analysis-detail";
import { SrePopupPanel } from "./components/sre-popup-panel";

/** Workload kinds for which we inject the SRE analysis hooks. */
const WORKLOAD_KINDS = [
  { kind: "Pod",         apiVersions: ["v1"] },
  { kind: "Deployment",  apiVersions: ["apps/v1"] },
  { kind: "StatefulSet", apiVersions: ["apps/v1"] },
  { kind: "DaemonSet",   apiVersions: ["apps/v1"] },
  { kind: "ReplicaSet",  apiVersions: ["apps/v1"] },
];

export default class K8sSreRenderer extends Renderer.LensExtension {
  async onActivate() {
    console.log("[K8s SRE Assistant] Renderer activated");
    ChatStore.getInstance().checkConnection();
  }

  /** Floating SRE chat popup panel — appears when a workload diagnose button is clicked. */
  clusterFrameComponents = [
    {
      id: "k8s-sre-assistant-popup",
      Component: SrePopupPanel,
      shouldRender: computed(() => ChatStore.getInstance().popupOpen),
    },
  ];

  clusterPages = [
    {
      id: "k8s-sre-assistant",
      components: {
        Page: () => <SreAssistantPage extension={this} />,
      },
    },
  ];

  clusterPageMenus = [
    {
      id: "k8s-sre-assistant",
      title: "K8s SRE Assistant",
      target: { pageId: "k8s-sre-assistant" },
      components: {
        Icon: SreIcon,
      },
    },
  ];

  appPreferences = [
    {
      title: "K8s SRE Assistant",
      components: {
        Input: () => <SrePreferencesInput />,
        Hint: () => <SrePreferencesHint />,
      },
    },
  ];

  /** "🔗 SRE: Relationship Map" and "📊 SRE: Resource Analysis" in every workload context menu. */
  kubeObjectMenuItems = WORKLOAD_KINDS.map(({ kind, apiVersions }) => ({
    kind,
    apiVersions,
    components: {
      MenuItem: WorkloadAnalysisMenu,
    },
  }));

  /** SRE analysis buttons panel in every workload detail drawer. */
  kubeObjectDetailItems = WORKLOAD_KINDS.map(({ kind, apiVersions }) => ({
    kind,
    apiVersions,
    priority: 10,
    components: {
      Details: WorkloadAnalysisDetail,
    },
  }));
}
