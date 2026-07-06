"use client";

import React from "react";
import type { Component } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useEditorStore } from "../../lib/editor/store";
import { useLearnPrefs } from "../../lib/editor/learn-prefs";

export interface LearnPanelProps {
  /** Component resolver (defaults to the registry). Injected for tests. */
  resolveComponent?: (id: string) => Component | undefined;
}

/**
 * Inspector "Learn" panel (issue #80): a generic, data-driven renderer for the
 * selected component's optional `education` block (authored in #79, IR #78).
 * Zero per-part branching — every field is rendered straight from the data, so
 * new parts (incl. community submissions) get a competent panel for free.
 *
 * Contextual learning is **just-in-time, progressive, and optional**: it starts
 * collapsed (summary one-liner in the trigger; depth on expand) and self-hides
 * for a user who turned it off ({@link useLearnPrefs}). The live "try it" knob
 * (`education.interactiveHint`) is deliberately out of scope here — that's #81.
 *
 * Self-gates like {@link ErcPanel}, so the Inspector mounts it unconditionally.
 */
export function LearnPanel({ resolveComponent = getComponent }: LearnPanelProps = {}): React.JSX.Element | null {
  const selection = useEditorStore((s) => s.selection);
  const instances = useEditorStore((s) => s.bundle?.schematic.instances);
  const enabled = useLearnPrefs((s) => s.enabled);
  const setEnabled = useLearnPrefs((s) => s.setEnabled);

  if (!enabled) return null;
  if (selection.length !== 1) return null;

  const instance = instances?.find((i) => i.instanceId === selection[0]);
  const education = instance ? resolveComponent(instance.componentId)?.education : undefined;
  // Nothing worth showing (no block, or an empty one) → render nothing.
  if (!education || !education.summary) return null;

  const gotchas = education.gotchas ?? [];
  const paramNotes = Object.entries(education.paramNotes ?? {});

  return (
    <div data-testid="learn-panel">
      <Collapsible
        defaultIsOpen={false}
        data-testid="learn-collapsible"
        trigger={
          <VStack gap={0.5} align="start">
            <Text type="label" color="accent">
              Learn
            </Text>
            <Text type="supporting" color="secondary">
              {education.summary}
            </Text>
          </VStack>
        }
      >
        <VStack gap={2}>
          {gotchas.length > 0 && (
            <VStack gap={1}>
              <Text type="label" color="secondary">
                Watch out for
              </Text>
              <VStack gap={0.5} role="list">
                {gotchas.map((g, i) => (
                  <Text key={i} type="supporting" color="primary">
                    • {g}
                  </Text>
                ))}
              </VStack>
            </VStack>
          )}

          {education.keyFormula && (
            <VStack gap={1}>
              <Text type="label" color="secondary">
                Key formula
              </Text>
              <Text type="body" color="primary">
                {education.keyFormula.display}
              </Text>
              <VStack gap={0.5}>
                {Object.entries(education.keyFormula.variables).map(([sym, desc]) => (
                  <Text key={sym} type="supporting" color="secondary">
                    {sym} — {desc}
                  </Text>
                ))}
              </VStack>
            </VStack>
          )}

          {paramNotes.length > 0 && (
            <VStack gap={1}>
              <Text type="label" color="secondary">
                Parameters
              </Text>
              {paramNotes.map(([name, note]) => (
                <Text key={name} type="supporting" color="secondary">
                  {name}: {note}
                </Text>
              ))}
            </VStack>
          )}

          <HStack gap={1} align="center">
            <Button
              label="Hide Learn tips"
              size="sm"
              variant="ghost"
              onClick={() => setEnabled(false)}
            />
          </HStack>
        </VStack>
      </Collapsible>
    </div>
  );
}
