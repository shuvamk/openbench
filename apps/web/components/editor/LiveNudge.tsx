"use client";

import React, { useEffect, useRef } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { getComponent } from "@openbench/registry";
import { useEditorStore } from "../../lib/editor/store";
import { useSimStore } from "../../lib/sim/store";
import { useLiveStore } from "../../lib/live/store";
import { hasLiveVisual } from "../../lib/live/derive";

/**
 * Design→Live nudge (issue #73). A beginner builds in Design mode, hits ▶ Run,
 * and gets a waveform graph — not the glowing LED they pictured. After a
 * *successful* run in Design mode, when the circuit has something Live can
 * actually visualize (LED/RGB/motor/buzzer/lamp), point them at the mode that
 * does the thing they asked for. Non-nagging: fires once per completed run,
 * clears on entering Live or on dismiss, never re-pops on its own.
 */
export function LiveNudge() {
  const bundle = useEditorStore((s) => s.bundle);
  const status = useSimStore((s) => s.status);
  const run = useSimStore((s) => s.run);
  const mode = useLiveStore((s) => s.mode);
  const nudge = useLiveStore((s) => s.nudge);
  const showNudge = useLiveStore((s) => s.showNudge);
  const dismissNudge = useLiveStore((s) => s.dismissNudge);
  const enterLive = useLiveStore((s) => s.enterLive);

  // Fire exactly once per successful run (track the run id we last nudged for),
  // and only from Design mode on a circuit with a live visual.
  const nudgedRunId = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "completed" || run === undefined || run.status !== "completed") return;
    if (run.id === nudgedRunId.current) return;
    nudgedRunId.current = run.id;
    if (mode !== "design" || !bundle) return;
    if (hasLiveVisual(bundle.schematic, getComponent)) showNudge();
  }, [status, run, mode, bundle, showNudge]);

  if (!nudge || mode !== "design") return null;

  return (
    <div data-testid="ob-live-nudge" style={{ marginTop: 8 }}>
      <Banner
        status="success"
        title="✨ See it glow"
        description="Your circuit ran. Switch to Live to watch the parts light up, spin, and react."
        isDismissable
        onDismiss={() => dismissNudge()}
        endContent={
          <Button
            label="Switch to Live mode"
            variant="secondary"
            size="sm"
            onClick={() => void enterLive()}
          >
            Live →
          </Button>
        }
      />
    </div>
  );
}
