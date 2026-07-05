"use client";

import React, { use, useEffect } from "react";
import { Text } from "@astryxdesign/core/Text";
import { CommandPalette } from "../../../components/editor/CommandPalette";
import { EditorTopBar } from "../../../components/editor/EditorTopBar";
import { Inspector } from "../../../components/editor/Inspector";
import { Palette } from "../../../components/editor/Palette";
import { SchematicCanvas } from "../../../components/editor/SchematicCanvas";
import { SimPanel } from "../../../components/sim/SimPanel";
import { PlaybackBar } from "../../../components/editor/PlaybackBar";
import { resetEditorState, useEditorStore } from "../../../lib/editor/store";
import { resetLiveState, useLiveStore } from "../../../lib/live/store";
import { resetSimState } from "../../../lib/sim/store";

/**
 * The schematic editor page: full-viewport, no page scroll.
 *
 *  ┌──────────── EditorTopBar ────────────┐
 *  │ Palette │   SchematicCanvas │ Inspector │
 *  └────────── #ob-sim-panel-slot ────────┘  (filled by the sim agent)
 */
export default function EditorPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const loadProject = useEditorStore((s) => s.loadProject);
  const loadError = useEditorStore((s) => s.loadError);
  const mode = useLiveStore((s) => s.mode);

  useEffect(() => {
    resetEditorState();
    resetSimState();
    resetLiveState();
    void loadProject(projectId);
    return () => {
      // Flush any pending autosave before leaving the editor.
      void useEditorStore.getState().flushSave();
    };
  }, [projectId, loadProject]);

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <EditorTopBar />
      <CommandPalette />
      {loadError ? (
        <div style={{ padding: 24 }}>
          <Text type="body" color="secondary">
            Could not open this project: {loadError}
          </Text>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {mode === "design" && <Palette />}
          <SchematicCanvas />
          {mode === "design" && <Inspector />}
        </div>
      )}
      {mode === "live" && <PlaybackBar />}
      <div id="ob-sim-panel-slot">
        <SimPanel />
      </div>
    </div>
  );
}
