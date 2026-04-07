/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * WorkloadAnalysisDetail — panel injected into the workload detail drawer.
 * Icon-only "SRE: Diagnose" button — opens the SRE popup chat panel.
 */

import React from "react";
import { ChatStore } from "../stores/chat-store";
import { SreIcon } from "../icons/sre-icon";

interface WorkloadObject {
  getName(): string;
  getNs(): string | undefined;
  kind: string;
}

interface Props {
  object: WorkloadObject;
}

export function WorkloadAnalysisDetail({ object }: Props) {
  const kind = object.kind ?? "Workload";
  const name = object.getName();
  const namespace = object.getNs() ?? "default";

  return (
    <div style={containerStyle}>
      <button
        onClick={() =>
          ChatStore.getInstance().triggerWorkloadAnalysis(kind, name, namespace, "relationship")
        }
        style={btnStyle}
        title={`SRE: diagnose ${kind}/${name} in ${namespace}`}
        aria-label="SRE: Diagnose"
      >
        <SreIcon size={15} />
      </button>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderTop: "1px solid var(--borderColor, #313244)",
  marginTop: "4px",
  display: "flex",
  justifyContent: "flex-start",
};

const btnStyle: React.CSSProperties = {
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
  padding: 0,
};

