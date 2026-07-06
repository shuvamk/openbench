"use client";

import React from "react";
import type { Component } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { Slider } from "@astryxdesign/core/Slider";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useEditorStore } from "../../lib/editor/store";
import { useLearnPrefs } from "../../lib/editor/learn-prefs";
import { useLiveStore } from "../../lib/live/store";
import { knobReadout, resolveInteractiveKnob } from "../../lib/live/interactive-knob";

export interface LiveKnobProps {
  /** Component resolver (defaults to the registry). Injected for tests. */
  resolveComponent?: (id: string) => Component | undefined;
}

/**
 * The live "try it" knob (issue #81) — the differentiated, fun payoff of the
 * contextual-learning epic (#76). Sits in the Inspector's Learn area beneath the
 * static {@link LearnPanel} and turns the selected part's `education.interactiveHint`
 * into one slider: drag it and the sim re-runs (debounced) on the user's *actual*
 * circuit, with a live read-out of the effect — the canonical demo being a series
 * resistor driving LED brightness/current.
 *
 * Self-gating like {@link ErcPanel}/{@link LearnPanel}, so the Inspector mounts it
 * unconditionally. It hides unless three things hold: the part has an interactive
 * hint, the circuit actually simulated (a completed run yields the watched series —
 * composes with #72, no knob on a broken circuit), and the user hasn't opted out of
 * Learn tips. All physics reuse the existing live pipeline — no parallel sim path.
 */
export function LiveKnob({ resolveComponent = getComponent }: LiveKnobProps = {}): React.JSX.Element | null {
  const selection = useEditorStore((s) => s.selection);
  const bundle = useEditorStore((s) => s.bundle);
  const enabled = useLearnPrefs((s) => s.enabled);
  // Subscribe so the read-out re-derives when a live rerun flips `simulating`.
  useLiveStore((s) => s.simulating);

  if (!enabled) return null;
  if (selection.length !== 1) return null;

  const knob = resolveInteractiveKnob(bundle, selection[0], resolveComponent);
  if (!knob) return null;
  const readout = knobReadout(bundle, knob.subjectInstanceId, knob.observe, resolveComponent);
  // No usable run → nothing to show or watch. Hide rather than present a dead knob.
  if (!readout) return null;

  const label = knob.unit ? `${knob.targetParam} (${knob.unit})` : knob.targetParam;

  return (
    <div data-testid="live-knob">
      <VStack gap={1} align="start">
        <Text type="label" color="accent">
          Try it
        </Text>
        <Text type="supporting" color="secondary">
          {knob.prompt}
        </Text>
        <Slider
          label={label}
          value={knob.value}
          min={knob.min}
          max={knob.max}
          step={knob.step}
          valueDisplay="text"
          formatValue={(v: number) => formatParam(v, knob.unit)}
          onChange={(v: number) => useLiveStore.getState().interact(knob.targetInstanceId, knob.targetParam, v)}
          data-testid="live-knob-slider"
        />
        <Text type="supporting" color="secondary" data-testid="live-knob-readout">
          {knob.observe}: {formatReadout(readout.value, readout.unit)}
        </Text>
      </VStack>
    </div>
  );
}

/** Compact slider value, e.g. "330 Ω" style — unit appended by the label. */
function formatParam(value: number, unit?: string): string {
  const rounded = value >= 100 ? Math.round(value) : Number(value.toFixed(2));
  return unit ? `${rounded} ${unit}` : String(rounded);
}

/**
 * Read-out formatter. With a unit, apply a milli/micro prefix so small currents
 * read cleanly ("15.0 mA"); dimensionless series (brightness) just show 2 dp.
 */
function formatReadout(value: number, unit: string): string {
  if (!unit) return value.toFixed(2);
  const abs = Math.abs(value);
  if (abs === 0) return `0 ${unit}`;
  if (abs < 1e-3) return `${(value * 1e6).toFixed(1)} µ${unit}`;
  if (abs < 1) return `${(value * 1e3).toFixed(1)} m${unit}`;
  return `${value.toFixed(2)} ${unit}`;
}
