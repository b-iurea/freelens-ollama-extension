/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * WorkloadAnalysisMenu — "SRE: Diagnose" injected into workload 3-dot menus
 * (dropdown) and toolbar icon for Pods, Deployments, StatefulSets,
 * DaemonSets, and ReplicaSets.
 *
 * Clicking opens the floating SRE popup panel and auto-sends a
 * relationship/graph diagnosis prompt.
 */

import React from "react";
import { Renderer } from "@freelensapp/extensions";
import { ChatStore } from "../stores/chat-store";
import { SreIcon } from "../icons/sre-icon";

const { MenuItem } = Renderer.Component;

/** Minimal interface for the KubeObject passed by Freelens. */
interface WorkloadObject {
  getName(): string;
  getNs(): string | undefined;
  kind: string;
}

interface Props {
  object: WorkloadObject;
  toolbar?: boolean;
}

export function WorkloadAnalysisMenu({ object, toolbar }: Props) {
  const kind = object.kind ?? "Workload";
  const name = object.getName();
  const namespace = object.getNs() ?? "default";

  const handleDiagnose = () => {
    ChatStore.getInstance().triggerWorkloadAnalysis(kind, name, namespace, "relationship");
  };

  if (toolbar) {
    return (
      <button
        onClick={handleDiagnose}
        style={toolbarBtnStyle}
        title={`SRE: diagnose ${kind}/${name} — relationship & dependency graph`}
        aria-label="SRE: Diagnose"
      >
        <SreIcon size={16} />
      </button>
    );
  }

  return (
    <MenuItem onClick={handleDiagnose} icon="search">
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
        <SreIcon size={13} />
        SRE: Diagnose
      </span>
    </MenuItem>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  border: "1px solid var(--borderColor, #313244)",
  borderRadius: "6px",
  background: "transparent",
  color: "var(--textColorSecondary, #a6adc8)",
  cursor: "pointer",
  flexShrink: 0,
  padding: 0,
};
