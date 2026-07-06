"use client";

import React, { useMemo, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { getComponent } from "@openbench/registry";
import { useEditorStore } from "../../lib/editor/store";
import {
  createCopilot,
  type CopilotProposal,
  type PartExplanation,
} from "../../lib/copilot/engine";
import type { Explanation } from "../../lib/copilot/explain";

/**
 * The in-app AI copilot panel (issue #43). Natural-language → reviewable IR
 * diffs. Every proposed change is shown as a diff and is NOT applied until the
 * user accepts it; accepting flows through the editor's normal mutation + undo
 * stack (`applySchematic`). A read-only "Explain circuit" action consumes ERC +
 * the latest simulation run; "Explain this part" grounds its answer in the
 * selected component's IR `education` block (issue #82), the same single source
 * of truth the Learn panel renders. Model access is key-optional: without a key
 * the panel
 * runs in a scripted mock mode, so the keyless deploy still works (ADR-0003).
 *
 * Astryx components/tokens only — no raw hex.
 */
export function CopilotPanel() {
  const bundle = useEditorStore((s) => s.bundle);
  const selection = useEditorStore((s) => s.selection);
  const applySchematic = useEditorStore((s) => s.applySchematic);

  // The copilot instance reads its key from the environment; absent one it is
  // in mock mode. `NEXT_PUBLIC_` so the client can see it when configured.
  const copilot = useMemo(
    () => createCopilot({ apiKey: process.env.NEXT_PUBLIC_OPENBENCH_COPILOT_KEY }),
    [],
  );

  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<CopilotProposal | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [partExplanation, setPartExplanation] = useState<PartExplanation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!bundle) return null;
  const schematic = bundle.schematic;
  const simulationRuns = bundle.simulationRuns;

  // The single selected instance's component, if exactly one is selected — the
  // subject of "explain this part" (grounded in its IR education block, #82).
  const selectedComponent =
    selection.length === 1
      ? getComponent(
          schematic.instances.find((i) => i.instanceId === selection[0])?.componentId ?? "",
        )
      : undefined;

  function ask() {
    setExplanation(null);
    setPartExplanation(null);
    setNotice(null);
    const next = copilot.propose(schematic, prompt);
    if (!next) {
      setProposal(null);
      setNotice("I couldn't turn that into a change yet. Try “add a resistor”.");
      return;
    }
    setProposal(next);
  }

  function accept() {
    if (!proposal) return;
    // Route the accepted change through the normal editor mutation stack so it
    // records exactly one undo entry.
    applySchematic(proposal.after);
    setProposal(null);
    setPrompt("");
  }

  function reject() {
    setProposal(null);
  }

  function explain() {
    setProposal(null);
    setPartExplanation(null);
    setNotice(null);
    setExplanation(copilot.explain(schematic, simulationRuns));
  }

  function explainPart() {
    if (!selectedComponent) return;
    setProposal(null);
    setExplanation(null);
    setNotice(null);
    setPartExplanation(copilot.explainPart(selectedComponent));
  }

  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        overflowY: "auto",
        borderLeft: "1px solid var(--ob-canvas-grid)",
        padding: 12,
        boxSizing: "border-box",
      }}
      aria-label="AI copilot"
    >
      <VStack gap={3}>
        <HStack gap={1} align="center" justify="between">
          <Text type="label" color="primary">
            Copilot
          </Text>
          <Badge
            variant={copilot.mode === "live" ? "blue" : "neutral"}
            label={copilot.mode === "live" ? "AI" : "Mock"}
          />
        </HStack>

        <TextInput
          label="Ask the copilot"
          placeholder="e.g. add a resistor"
          value={prompt}
          onChange={(value: string) => setPrompt(value)}
        />

        <HStack gap={1}>
          <Button
            label="Ask"
            variant="primary"
            size="sm"
            isDisabled={prompt.trim().length === 0}
            onClick={ask}
          >
            Ask
          </Button>
          <Button label="Explain circuit" variant="secondary" size="sm" onClick={explain}>
            Explain circuit
          </Button>
        </HStack>

        {selectedComponent && (
          <Button
            label={`Explain ${selectedComponent.name}`}
            variant="secondary"
            size="sm"
            onClick={explainPart}
          >
            Explain this part
          </Button>
        )}

        {notice && (
          <Text type="body" color="secondary">
            {notice}
          </Text>
        )}

        {proposal && (
          <>
            <Divider />
            <VStack gap={2}>
              <Text type="label" color="secondary">
                Proposed change
              </Text>
              <Text type="body" color="primary">
                {proposal.summary}
              </Text>
              <VStack gap={0.5}>
                {proposal.added.map((id) => (
                  <Text key={`add-${id}`} type="supporting" color="accent">
                    + {id}
                  </Text>
                ))}
                {proposal.removed.map((id) => (
                  <Text key={`rm-${id}`} type="supporting" color="secondary">
                    − {id}
                  </Text>
                ))}
              </VStack>
              <HStack gap={1}>
                <Button label="Accept" variant="primary" size="sm" onClick={accept}>
                  Accept
                </Button>
                <Button label="Reject" variant="secondary" size="sm" onClick={reject}>
                  Reject
                </Button>
              </HStack>
            </VStack>
          </>
        )}

        {explanation && (
          <>
            <Divider />
            <VStack gap={1}>
              <Text type="label" color="secondary">
                Explanation
              </Text>
              {explanation.summary.split("\n").map((line, index) => (
                <Text key={`exp-${index}`} type="body" color="primary">
                  {line}
                </Text>
              ))}
            </VStack>
          </>
        )}

        {partExplanation && (
          <>
            <Divider />
            <VStack gap={1}>
              <HStack gap={1} align="center" justify="between">
                <Text type="label" color="secondary">
                  {partExplanation.name}
                </Text>
                {!partExplanation.grounded && (
                  <Badge variant="neutral" label="general" />
                )}
              </HStack>
              <Text type="body" color="primary">
                {partExplanation.answer}
              </Text>
              {partExplanation.grounded &&
                partExplanation.context.split("\n").map((line, index) => (
                  <Text key={`part-${index}`} type="supporting" color="secondary">
                    {line}
                  </Text>
                ))}
            </VStack>
          </>
        )}
      </VStack>
    </div>
  );
}
