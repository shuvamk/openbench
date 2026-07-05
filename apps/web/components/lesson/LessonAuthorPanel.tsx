"use client";

import React, { useMemo, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { checkSchematic } from "@openbench/erc";
import { getComponent } from "@openbench/registry";
import type { ErcRunner, ResolveComponent, Step } from "@openbench/lesson";
import { useEditorStore } from "../../lib/editor/store";
import {
  deriveStepsFromHistory,
  editStepInList,
  loosenStepInList,
  mergeStepsInList,
  previewSteps,
  splitStepInList,
} from "../../lib/lesson/author";

/**
 * Teaching-author mode (issue 151), per .context/design/teaching-mode.md §5
 * (ADR-0022). Turns the circuit the author just built — captured as the editor
 * undo-history (#18) — into a candidate {@link Step}[] via
 * {@link deriveStepsFromHistory}, then lets the author refine it: edit each
 * step's instruction/hint, split a dense step into per-clause steps, merge
 * adjacent steps, and loosen exact values into tolerance bands. Every step
 * shows a live pass/fail badge ({@link previewSteps} → `evaluateStep`) against
 * the current schematic, so the author sees immediately whether their edits
 * still match the build.
 *
 * All logic is pure ({@link ../../lib/lesson/author}); this component only wires
 * it to the editor store, the registry, and the ERC engine, on Astryx.
 */
export interface LessonAuthorPanelProps {
  /** Component resolver (defaults to the registry). Injected for tests. */
  resolveComponent?: ResolveComponent;
  /** ERC runner (defaults to the engine). Injected for tests. */
  erc?: ErcRunner;
  /** Default loosen tolerance for the per-step Loosen action (percent). */
  loosenTolerancePct?: number;
}

const DEFAULT_ERC: ErcRunner = (schematic, resolve) => checkSchematic(schematic, resolve);

export function LessonAuthorPanel({
  resolveComponent = getComponent,
  erc = DEFAULT_ERC,
  loosenTolerancePct = 10,
}: LessonAuthorPanelProps): React.JSX.Element {
  const bundle = useEditorStore((s) => s.bundle);
  const past = useEditorStore((s) => s.past);
  const schematic = bundle?.schematic;

  const [steps, setSteps] = useState<Step[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const previews = useMemo(
    () => (steps && schematic ? previewSteps(steps, schematic, resolveComponent, erc) : []),
    [steps, schematic, resolveComponent, erc],
  );

  function derive(): void {
    if (!schematic) return;
    setSteps(deriveStepsFromHistory(past, schematic));
    setSelected([]);
  }

  function toggleSelect(id: string): void {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const passingCount = previews.filter((p) => p.result.passed).length;

  return (
    <VStack gap={1} data-testid="lesson-author">
      <HStack gap={1} align="center" justify="between">
        <Text type="label" color="primary">
          Teaching author
        </Text>
        <Button
          label="Derive steps from build"
          variant="primary"
          size="sm"
          isDisabled={!schematic}
          onClick={derive}
        >
          {steps === null ? "Derive steps from build" : "Re-derive from build"}
        </Button>
      </HStack>

      {steps === null && (
        <Text type="body" color="secondary">
          Build a circuit on the canvas, then derive a step-by-step lesson from your edit
          history. Each recorded batch becomes one candidate step you can refine.
        </Text>
      )}

      {steps !== null && steps.length === 0 && (
        <Text type="body" color="secondary">
          No structural changes recorded yet — add and wire some parts, then derive again.
        </Text>
      )}

      {steps !== null && steps.length > 0 && (
        <>
          <HStack gap={1} align="center" justify="between">
            <Text type="supporting" color="secondary">
              {passingCount}/{previews.length} steps pass against the current schematic
            </Text>
            <Button
              label="Merge selected steps"
              variant="secondary"
              size="sm"
              isDisabled={selected.length < 2}
              onClick={() => {
                setSteps((cur) => (cur ? mergeStepsInList(cur, selected) : cur));
                setSelected([]);
              }}
            >
              Merge selected
            </Button>
          </HStack>
          <VStack gap={1}>
            {steps.map((step, i) => {
              const passed = previews[i]?.result.passed ?? false;
              return (
                <React.Fragment key={step.id}>
                  {i > 0 && <Divider />}
                  <div data-testid="author-step" data-step-id={step.id} data-passed={passed}>
                    <VStack gap={0.5}>
                      <HStack gap={1} align="center" justify="between">
                        <HStack gap={1} align="center">
                          <CheckboxInput
                            label={`Select step ${i + 1} for merge`}
                            isLabelHidden
                            value={selected.includes(step.id)}
                            onChange={() => toggleSelect(step.id)}
                          />
                          <Badge
                            variant={passed ? "success" : "warning"}
                            label={passed ? "passes" : "no match"}
                          />
                        </HStack>
                        <HStack gap={0.5} align="center">
                          <Button
                            label={`Split step ${i + 1}`}
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSteps((cur) => (cur ? splitStepInList(cur, step.id) : cur))
                            }
                          >
                            Split
                          </Button>
                          <Button
                            label={`Loosen step ${i + 1} tolerances`}
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSteps((cur) =>
                                cur ? loosenStepInList(cur, step.id, loosenTolerancePct) : cur,
                              )
                            }
                          >
                            Loosen
                          </Button>
                        </HStack>
                      </HStack>
                      <TextInput
                        label={`Instruction for step ${i + 1}`}
                        isLabelHidden
                        value={step.instruction}
                        onChange={(value) =>
                          setSteps((cur) =>
                            cur ? editStepInList(cur, step.id, { instruction: value }) : cur,
                          )
                        }
                      />
                      <TextInput
                        label={`Hint for step ${i + 1}`}
                        isLabelHidden
                        placeholder="Optional hint…"
                        value={step.hint ?? ""}
                        onChange={(value) =>
                          setSteps((cur) =>
                            cur ? editStepInList(cur, step.id, { hint: value }) : cur,
                          )
                        }
                      />
                    </VStack>
                  </div>
                </React.Fragment>
              );
            })}
          </VStack>
        </>
      )}
    </VStack>
  );
}
