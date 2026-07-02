"use client";

import React, { use, useEffect } from "react";
import { Text } from "@astryxdesign/core/Text";
import { EditorTopBar } from "../../../components/editor/EditorTopBar";
import { Inspector } from "../../../components/editor/Inspector";
import { Palette } from "../../../components/editor/Palette";
import { SchematicCanvas } from "../../../components/editor/SchematicCanvas";
import { SimPanel } from "../../../components/sim/SimPanel";
import { resetEditorState, useEditorStore } from "../../../lib/editor/store";
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

  useEffect(() => {
    resetEditorState();
    resetSimState();
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
      {loadError ? (
        <div style={{ padding: 24 }}>
          <Text type="body" color="secondary">
            Could not open this project: {loadError}
          </Text>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <Palette />
          <SchematicCanvas />
          <Inspector />
        </div>
      )}
      <div id="ob-sim-panel-slot">
        <SimPanel />
      </div>
    </div>
  );
}
