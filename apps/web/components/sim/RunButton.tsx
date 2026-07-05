"use client";

import React from "react";
import { Button } from "@astryxdesign/core/Button";
import { useEditorStore } from "../../lib/editor/store";
import { useSimStore, type SimPhase } from "../../lib/sim/store";

/** What the run is doing right now, for the button while it's in flight. */
export function runPhaseLabel(phase: SimPhase, backendUsed: string | undefined): string {
  switch (phase) {
    case "compiling":
      return "Compiling…";
    case "simulating":
      return backendUsed ? `Simulating (${backendUsed})…` : "Simulating…";
    default:
      return "▶ Run";
  }
}

/** Primary "▶ Run" button mounted in the editor top bar (#ob-run-slot). */
export function RunButton() {
  const bundle = useEditorStore((s) => s.bundle);
  const status = useSimStore((s) => s.status);
  const phase = useSimStore((s) => s.phase);
  const backendUsed = useSimStore((s) => s.backendUsed);
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
      {isRunning ? runPhaseLabel(phase, backendUsed) : "▶ Run"}
    </Button>
  );
}
