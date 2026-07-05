"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Divider } from "@astryxdesign/core/Divider";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { checkSchematic } from "@openbench/erc";
import { getComponent } from "@openbench/registry";
import type { ErcRunner, Lesson, ResolveComponent } from "@openbench/lesson";
import { useEditorStore } from "../../lib/editor/store";
import {
  deriveRunnerView,
  type RunnerStep,
  type RunnerStepStatus,
} from "../../lib/lesson/runner";

/**
 * Teaching-mode student runner (issue #91), per .context/design/teaching-mode.md
 * §3.3–3.4 (ADR-0022). A side panel that subscribes to the live editor IR store,
 * re-evaluates the current step's SchematicPredicate on every mutation
 * (debounced), and drives a linear stepper: each top-level clause shows as a
 * checklist row, the active step greens + advances the moment it passes, a wrong
 * value keeps it red with its hint, and ERC issues surface as inline, advisory
 * warnings that never gate advancement.
 *
 * Validation is pure ({@link deriveRunnerView}); this component only wires it to
 * the store, the registry, and the ERC engine and renders it on Astryx.
 */
export interface StudentRunnerPanelProps {
  lesson: Lesson;
  /** IR-mutation debounce before re-validating (ms). Tests pass `0`. */
  debounceMs?: number;
  /** Component resolver (defaults to the registry). Injected for tests. */
  resolveComponent?: ResolveComponent;
  /** ERC runner (defaults to the engine). Injected for tests. */
  erc?: ErcRunner;
  /** Fired once when the final step passes. */
  onComplete?: () => void;
}

/** A structurally-empty schematic so an un-loaded editor still evaluates cleanly. */
function emptySchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_lesson_empty",
    projectId: "proj_lesson_empty",
    instances: [],
    nets: [],
    provenance: { source: "frontend", at: new Date(0).toISOString() },
  };
}

/** Debounce a value; a non-positive delay still defers to the next tick. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), Math.max(0, delayMs));
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const STEP_DOT: Record<RunnerStepStatus, "success" | "warning" | "neutral"> = {
  passed: "success",
  active: "warning",
  locked: "neutral",
};

export function StudentRunnerPanel({
  lesson,
  debounceMs = 200,
  resolveComponent = getComponent,
  erc = checkSchematic,
  onComplete,
}: StudentRunnerPanelProps) {
  const schematic = useEditorStore((s) => s.bundle?.schematic);
  const debounced = useDebouncedValue(schematic, debounceMs);

  const view = useMemo(
    () => deriveRunnerView(lesson, debounced ?? emptySchematic(), resolveComponent, erc),
    [lesson, debounced, resolveComponent, erc],
  );

  // Fire onComplete exactly once when the lesson first finishes.
  const firedComplete = useRef(false);
  useEffect(() => {
    if (view.complete && !firedComplete.current) {
      firedComplete.current = true;
      onComplete?.();
    }
    if (!view.complete) firedComplete.current = false;
  }, [view.complete, onComplete]);

  return (
    <VStack
      gap={2}
      data-lesson-runner=""
      data-active-step={view.active?.step.id ?? ""}
      data-complete={String(view.complete)}
    >
      <VStack gap={0.5}>
        <Text type="label" color="secondary">
          Lesson
        </Text>
        <Text type="body" color="primary">
          {lesson.title}
        </Text>
      </VStack>

      <Divider />

      <VStack gap={1} role="list">
        {view.steps.map((rs, i) => (
          <StepRow key={rs.step.id} step={rs} index={i} />
        ))}
      </VStack>

      {view.active ? (
        <ActiveStepDetail step={view.active} />
      ) : (
        <Text type="body" color="accent" data-lesson-done="">
          ✓ Lesson complete — nice work!
        </Text>
      )}

      {view.warnings.length > 0 && (
        <VStack gap={1}>
          <Text type="label" color="secondary">
            Heads up
          </Text>
          {view.warnings.map((warning, i) => (
            <HStack key={i} gap={1} align="start" data-step-warning="">
              <StatusDot variant="warning" label="Warning" />
              <Text type="supporting" color="secondary">
                {warning}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

function StepRow({ step, index }: { step: RunnerStep; index: number }) {
  return (
    <HStack
      gap={1}
      align="start"
      role="listitem"
      data-lesson-step={step.step.id}
      data-step-status={step.status}
    >
      <StatusDot variant={STEP_DOT[step.status]} label={step.status} />
      <Text type="supporting" color={step.status === "locked" ? "secondary" : "primary"}>
        {index + 1}. {firstLine(step.step.instruction)}
      </Text>
    </HStack>
  );
}

function ActiveStepDetail({ step }: { step: RunnerStep }) {
  const { result } = step;
  const showHint = !result.passed && step.step.hint;

  return (
    <VStack gap={1.5} data-lesson-active-detail="">
      <Text type="body" color="primary">
        {step.step.instruction}
      </Text>

      <VStack gap={1}>
        {result.clauses.map((clause, i) => (
          <HStack
            key={i}
            gap={1}
            align="start"
            data-clause=""
            data-clause-satisfied={String(clause.satisfied)}
          >
            <StatusDot
              variant={clause.satisfied ? "success" : "neutral"}
              label={clause.satisfied ? "Done" : "To do"}
            />
            <Text type="supporting" color={clause.satisfied ? "secondary" : "primary"}>
              {clause.describe}
            </Text>
          </HStack>
        ))}
      </VStack>

      {showHint && (
        <HStack gap={1} align="start" data-step-hint="">
          <Text type="supporting" color="secondary">
            💡 {step.step.hint}
          </Text>
        </HStack>
      )}
    </VStack>
  );
}

/** First non-empty line of a markdown instruction, for the compact stepper row. */
function firstLine(markdown: string): string {
  const line = markdown.split("\n").find((l) => l.trim().length > 0);
  return (line ?? markdown).trim();
}
