/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 */

import { Renderer } from "@freelensapp/extensions";
import { SreAssistantPage } from "./pages/sre-assistant-page";
import { SreIcon } from "./icons/sre-icon";
import { SrePreferencesInput, SrePreferencesHint } from "./preferences/sre-preferences";
import { ChatStore } from "./stores/chat-store";

export default class K8sSreRenderer extends Renderer.LensExtension {
  async onActivate() {
    console.log("[K8s SRE Assistant] Renderer activated");
    const store = ChatStore.getInstance();
    store.checkConnection();
  }

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
}
