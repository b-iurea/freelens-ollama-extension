/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * SRE Assistant Page - wraps the chat component for Freelens cluster page
 */

import type { Renderer } from "@freelensapp/extensions";
import { SreChat } from "../components/sre-chat";

interface SreAssistantPageProps {
  extension: Renderer.LensExtension;
}

export function SreAssistantPage(_props: SreAssistantPageProps) {
  return (
    <div
      style={{
        height: "100%",
        overflow: "hidden",
      }}
    >
      <SreChat />
    </div>
  );
}
