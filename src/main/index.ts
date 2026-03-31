/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 */

import { Main } from "@freelensapp/extensions";

export default class K8sSreMain extends Main.LensExtension {
  async onActivate() {
    console.log("[K8s SRE Assistant] Main process activated");
  }

  async onDeactivate() {
    console.log("[K8s SRE Assistant] Main process deactivated");
  }
}
