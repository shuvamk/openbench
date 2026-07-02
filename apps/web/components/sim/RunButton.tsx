"use client";

import React from "react";
import { Button } from "@astryxdesign/core/Button";
import { useEditorStore } from "../../lib/editor/store";
import { useSimStore } from "../../lib/sim/store";

/** Primary "▶ Run" button mounted in the editor top bar (#ob-run-slot). */
export function RunButton() {
  const bundle = useEditorStore((s) => s.bundle);
  const status = useSimStore((s) => s.status);
  const runSimulation = useSimStore((s) => s.runSimulation);

  const isRunning = status === "queued" || status === "running";

  return (
    <Button
      label="Run simulation"
      variant="primary"
      size="sm"
      isLoading={isRunning}
      isDisabled={!bundle}
      onClick={() => void runSimulation()}
    >
      ▶ Run
    </Button>
  );
}
