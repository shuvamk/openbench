"use client";

import React, { useEffect, useState } from "react";
import { Link } from "@astryxdesign/core/Link";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { HStack, StackItem } from "@astryxdesign/core/Stack";
import { resetEditorState, useEditorStore } from "../../lib/editor/store";
import { resetSimState } from "../../lib/sim/store";
import { resetLiveState } from "../../lib/live/store";
import { decodeShare } from "../../lib/share";
import { SchematicCanvas } from "../editor/SchematicCanvas";
import { RunButton } from "../sim/RunButton";

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error" };

/**
 * Embeddable, read-only simulator (issue #40): decodes a stateless share payload
 * into a read-only project and renders minimal chrome — project name, a Run
 * button, and the schematic canvas — sized to drop into an iframe. No editing,
 * no persistence, no account; the whole design travels in the URL (ADR-0008).
 */
export function EmbedSimulator({ payload }: { payload: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const projectName = useEditorStore((s) => s.bundle?.project.name);

  useEffect(() => {
    let cancelled = false;
    resetEditorState();
    resetSimState();
    resetLiveState();
    decodeShare(payload)
      .then((bundle) => {
        if (cancelled) return;
        useEditorStore.getState().loadShared(bundle);
        setPhase({ kind: "ready" });
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (phase.kind === "error") {
    return (
      <div style={{ padding: 24 }}>
        <Text type="body" color="secondary">
          This shared link couldn’t be opened — the design data is missing or
          corrupted. Ask for a fresh link, or open OpenBench to start your own.
        </Text>
      </div>
    );
  }

  if (phase.kind === "loading") {
    return (
      <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          borderBottom: "1px solid var(--ob-canvas-grid)",
          padding: "8px 12px",
          boxSizing: "border-box",
        }}
      >
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <Text type="body" weight="semibold">
              {projectName ?? "Shared design"}
            </Text>
          </StackItem>
          <StackItem size="static">
            <RunButton />
          </StackItem>
          <StackItem size="static">
            <Link href="/" isStandalone>
              Open in OpenBench ↗
            </Link>
          </StackItem>
        </HStack>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <SchematicCanvas />
      </div>
    </div>
  );
}
