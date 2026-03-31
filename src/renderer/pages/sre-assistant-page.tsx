/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * SRE Assistant Page - wraps the chat component for Freelens cluster page
 */

import type { Renderer } from "@freelensapp/extensions";
import React from "react";
import { SreChat } from "../components/sre-chat";

interface SreAssistantPageProps {
  extension: Renderer.LensExtension;
}

export function SreAssistantPage(_props: SreAssistantPageProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: "hidden",
      }}
    >
      <SreChat />
    </div>
  );
}
