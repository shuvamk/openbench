import type { Component, Schematic } from "@openbench/ir-schema";
import type { ProjectBundle } from "../project-store";
import { deriveInstanceStates } from "./derive";
import { latestRun } from "./store";

/**
 * The live "try it" knob (issue #81). Turns a component's `education.interactiveHint`
 * into a single slider that writes a parameter override and re-runs the existing
 * sim, then watches a derived series on the part being taught. Pure resolution —
 * no React, no store mutation — so the component ({@link LiveKnob}) stays a thin
 * shell over well-tested logic.
 *
 * The hero case (spike #77) is the LED, whose hint addresses the *series resistor*
 * (`targetComponentId`) while observing the LED's own `brightness`/`current`. The
 * resolver handles both that redirection and the simpler self-knob (the resistor
 * teaching its own `resistance`) with one declarative path — zero per-part code.
 */

/** The slider spans nominal/FACTOR … nominal·FACTOR (parameters carry no min/max). */
const RANGE_FACTOR = 10;

export interface ResolvedKnob {
  /** The instance being taught — whose derived `observe` series we watch. */
  subjectInstanceId: string;
  /** The instance whose parameter the slider edits (may equal the subject). */
  targetInstanceId: string;
  /** Parameter name on the target instance's component to expose. */
  targetParam: string;
  /** Derived-series key on the subject to read back (e.g. `brightness`, `current`). */
  observe: string;
  /** One-sentence framing for the experiment. */
  prompt: string;
  /** Current value (override if set, else the component default), clamped to range. */
  value: number;
  min: number;
  max: number;
  step: number;
  /** Parameter unit for display, if the component declares one. */
  unit?: string;
}

/**
 * Nearest instance of `componentId` sharing a net with `subjectId` — "wired in
 * series/adjacent". For the hero LED+R+source loop this is unambiguous (the LED's
 * anode net touches exactly one resistor). Returns undefined when none is found,
 * so the knob simply hides rather than guessing.
 */
function nearestWiredInstance(
  schematic: Schematic,
  subjectId: string,
  componentId: string,
): string | undefined {
  const componentOf = new Map(schematic.instances.map((i) => [i.instanceId, i.componentId]));
  for (const net of schematic.nets) {
    if (!net.connections.some((c) => c.instanceId === subjectId)) continue;
    for (const connection of net.connections) {
      if (connection.instanceId !== subjectId && componentOf.get(connection.instanceId) === componentId) {
        return connection.instanceId;
      }
    }
  }
  return undefined;
}

export function resolveInteractiveKnob(
  bundle: ProjectBundle | null,
  selectedInstanceId: string | undefined,
  resolveComponent: (id: string) => Component | undefined,
): ResolvedKnob | null {
  if (!bundle || !selectedInstanceId) return null;
  const schematic = bundle.schematic;
  const subject = schematic.instances.find((i) => i.instanceId === selectedInstanceId);
  if (!subject) return null;

  const hint = resolveComponent(subject.componentId)?.education?.interactiveHint;
  if (!hint) return null;

  // Where the knob's parameter lives: the subject itself, or a wired neighbour.
  const targetInstanceId = hint.targetComponentId
    ? nearestWiredInstance(schematic, subject.instanceId, hint.targetComponentId)
    : subject.instanceId;
  if (!targetInstanceId) return null;

  const targetInstance = schematic.instances.find((i) => i.instanceId === targetInstanceId);
  if (!targetInstance) return null;

  const paramDef = resolveComponent(targetInstance.componentId)?.parameters.find(
    (p) => p.name === hint.targetParam,
  );
  // Only numeric parameters make a sensible slider.
  if (!paramDef || paramDef.type !== "number" || typeof paramDef.default !== "number") return null;

  const nominal = paramDef.default;
  // A multiplicative range needs a positive nominal; bail otherwise (hide, no crash).
  if (!(nominal > 0)) return null;
  const min = nominal / RANGE_FACTOR;
  const max = nominal * RANGE_FACTOR;
  const step = (max - min) / 100;

  const override = (targetInstance.parameterOverrides as Record<string, unknown> | undefined)?.[
    hint.targetParam
  ];
  const raw = typeof override === "number" ? override : nominal;
  const value = Math.min(Math.max(raw, min), max);

  return {
    subjectInstanceId: subject.instanceId,
    targetInstanceId,
    targetParam: hint.targetParam,
    observe: hint.observe,
    prompt: hint.prompt,
    value,
    min,
    max,
    step,
    ...(paramDef.unit ? { unit: paramDef.unit } : {}),
  };
}

/** Best-effort display unit for a known derived series (blank for dimensionless). */
const SERIES_UNITS: Record<string, string> = {
  current: "A",
  voltage: "V",
  power: "W",
};

export interface KnobReadout {
  /** The series key this reads (echoes the hint's `observe`). */
  observe: string;
  /** Peak magnitude of the observed series over the run window. */
  value: number;
  /** Display unit ("" for dimensionless series like brightness). */
  unit: string;
}

/**
 * Read the subject's `observe` series from the latest completed run. Returns null
 * when there is no run or the series is absent — the natural gate that keeps the
 * knob off a circuit that can't simulate (composes with issue #72). Peak magnitude
 * is a stable, drag-responsive summary (the LED sits near-DC, so peak ≈ value).
 */
export function knobReadout(
  bundle: ProjectBundle | null,
  subjectInstanceId: string,
  observe: string,
  resolveComponent: (id: string) => Component | undefined,
): KnobReadout | null {
  const run = latestRun(bundle);
  if (!bundle || !run) return null;
  const derived = deriveInstanceStates(bundle.schematic, resolveComponent, run);
  if (!derived.ok) return null;
  const series = derived.states.get(subjectInstanceId)?.series[observe];
  if (!series || series.length === 0) return null;
  let peak = 0;
  for (let i = 0; i < series.length; i++) {
    const magnitude = Math.abs(series[i]!);
    if (magnitude > peak) peak = magnitude;
  }
  return { observe, value: peak, unit: SERIES_UNITS[observe] ?? "" };
}
