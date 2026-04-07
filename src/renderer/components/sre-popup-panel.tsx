/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 *
 * SrePopupPanel — floating side-panel that slides in from the right side of the
 * cluster frame when a workload "SRE: Diagnose" button is clicked.
 *
 * Registered via `clusterFrameComponents` in index.tsx.
 * Visibility is controlled by `ChatStore.getInstance().popupOpen` (MobX observable).
 */

import { observer } from "mobx-react";
import React from "react";
import { ChatStore } from "../stores/chat-store";
import { SreChat } from "./sre-chat";

const SLIDE_IN_CSS = `
@keyframes sre-popup-slide-in {
  from { transform: translateX(100%); opacity: 0.6; }
  to   { transform: translateX(0);    opacity: 1;   }
}
`;

export const SrePopupPanel = observer(function SrePopupPanel() {
  const store = ChatStore.getInstance();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SLIDE_IN_CSS }} />
      <div style={containerStyle}>
        <SreChat onClose={() => store.closePopup()} popup />
      </div>
    </>
  );
});

const containerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: "640px",
  zIndex: 1000,
  display: "flex",
  flexDirection: "column",
  boxShadow: "-6px 0 24px rgba(0,0,0,0.55)",
  borderLeft: "1px solid var(--borderColor, #313244)",
  animation: "sre-popup-slide-in 0.22s cubic-bezier(0.22,1,0.36,1) both",
  background: "var(--mainBackground, #1e1e2e)",
};
