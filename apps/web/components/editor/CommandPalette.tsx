"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CommandPalette as AstryxCommandPalette } from "@astryxdesign/core/CommandPalette";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import { useEditorStore } from "../../lib/editor/store";
import { useSimStore } from "../../lib/sim/store";
import { useLiveStore } from "../../lib/live/store";
import { deriveErcIssues } from "../../lib/editor/erc";
import { exportProjectToKicad } from "../../lib/kicad/io";
import {
  buildEditorCommands,
  commandSearchItems,
  type CommandItemAux,
  type EditorCommand,
  type EditorCommandDeps,
} from "../../lib/editor/commands";

/** Trigger a browser download (same Blob + anchor pattern as the top bar). */
function downloadText(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Approximate schematic-space drop point for keyboard-placed parts: the centre
 * of the viewport mapped back through the current pan/zoom. Good enough for a
 * "drop it on screen" gesture; the user can nudge it afterwards.
 */
function viewportCenter(): { x: number; y: number } {
  const { pan, zoom } = useEditorStore.getState();
  const w = typeof window !== "undefined" ? window.innerWidth : 800;
  const h = typeof window !== "undefined" ? window.innerHeight : 600;
  return { x: (w / 2 - pan.x) / zoom, y: (h / 2 - pan.y) / zoom };
}

/**
 * Bind the palette's abstract commands to the live editor/sim/live stores. Every
 * binding reads state lazily via `getState()` so it always acts on the current
 * project, and routes through the same store actions the palette-less UI uses.
 */
function useCommandDeps(): EditorCommandDeps {
  return useMemo<EditorCommandDeps>(
    () => ({
      place: (component) =>
        useEditorStore.getState().place(component, viewportCenter()),
      runSimulation: () => void useSimStore.getState().runSimulation(),
      toggleLive: () => {
        const live = useLiveStore.getState();
        if (live.mode === "live") live.exitLive();
        else void live.enterLive();
      },
      checkErc: () => {
        const schematic = useEditorStore.getState().bundle?.schematic;
        if (!schematic) return;
        const first = deriveErcIssues(schematic).find(
          (issue) => issue.primaryInstanceId,
        );
        if (first?.primaryInstanceId) {
          useEditorStore.getState().setSelection([first.primaryInstanceId]);
        }
      },
      undo: () => useEditorStore.getState().undo(),
      redo: () => useEditorStore.getState().redo(),
      exportProject: () => {
        const bundle = useEditorStore.getState().bundle;
        if (!bundle) return;
        const { filename, text } = exportProjectToKicad(bundle);
        downloadText(filename, text, "text/plain");
      },
      importProject: () => {
        if (typeof window !== "undefined") window.location.href = "/";
      },
      openProjects: () => {
        if (typeof window !== "undefined") window.location.href = "/";
      },
    }),
    [],
  );
}

/**
 * Keyboard-first command palette (issue #38): Cmd/Ctrl+K summons an Astryx
 * CommandPalette exposing every editor action plus the whole component registry.
 * It is the human twin of the AI copilot — the same mutations, one keystroke away.
 */
export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  const deps = useCommandDeps();
  const commands = useMemo(() => buildEditorCommands(deps), [deps]);
  const commandsById = useMemo(
    () => new Map<string, EditorCommand>(commands.map((c) => [c.id, c])),
    [commands],
  );
  const searchSource = useMemo(
    () =>
      createStaticSource(commandSearchItems(commands), {
        keywords: (item) => (item.auxiliaryData as CommandItemAux).keywords,
      }),
    [commands],
  );

  // Cmd/Ctrl+K toggles the palette from anywhere in the editor.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setIsOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const runById = useCallback(
    (id: string) => {
      commandsById.get(id)?.run();
    },
    [commandsById],
  );

  return (
    <AstryxCommandPalette
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      searchSource={searchSource}
      onValueChange={runById}
      label="Command palette"
      emptyBootstrapText="Type a command…"
      emptySearchText="No matching commands"
    />
  );
}
