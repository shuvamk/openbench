"use client";

import React, { useEffect, useState } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { HStack, StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEditorStore } from "../../lib/editor/store";
import { useLiveStore } from "../../lib/live/store";
import { exportProjectToKicad } from "../../lib/kicad/io";
import { RunButton } from "../sim/RunButton";

/** Trigger a browser download (same Blob + anchor pattern as the dashboard export). */
function downloadText(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.5 3.5 2.5 6.5l3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 6.5h7a4 4 0 0 1 0 8h-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m10.5 3.5 3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 6.5h-7a4 4 0 0 0 0 8h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function ZoomOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Top bar: back link, inline-editable project name, save-state dot, zoom
 * controls, and the #ob-run-slot placeholder the simulation agent fills.
 */
export function EditorTopBar() {
  const bundle = useEditorStore((s) => s.bundle);
  const dirty = useEditorStore((s) => s.dirty);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const renameProject = useEditorStore((s) => s.renameProject);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const mode = useLiveStore((s) => s.mode);
  const enterLive = useLiveStore((s) => s.enterLive);
  const exitLive = useLiveStore((s) => s.exitLive);

  const [draftName, setDraftName] = useState<string | null>(null);

  // Keyboard: Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes. Window-level, like
  // the canvas shortcuts, and equally inert while typing in inputs.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      const state = useEditorStore.getState();
      if (e.shiftKey) {
        state.redo();
      } else {
        state.undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const projectName = bundle?.project.name ?? "Loading…";

  const commitName = () => {
    if (draftName !== null) renameProject(draftName);
    setDraftName(null);
  };

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: "1px solid var(--ob-canvas-grid)",
        padding: "8px 16px",
        boxSizing: "border-box",
      }}
    >
      <HStack gap={4} vAlign="center">
        <StackItem size="static">
          <Link href="/" isStandalone>
            ← Projects
          </Link>
        </StackItem>

        <StackItem size="static">
          {draftName === null ? (
            <span
              role="button"
              tabIndex={0}
              title="Rename project"
              style={{ cursor: "text" }}
              onClick={() => bundle && setDraftName(projectName)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && bundle) setDraftName(projectName);
              }}
            >
              <Text type="body" weight="semibold">
                {projectName}
              </Text>
            </span>
          ) : (
            <TextInput
              label="Project name"
              isLabelHidden
              size="sm"
              value={draftName}
              hasAutoFocus
              onChange={(next) => setDraftName(next)}
              onBlur={commitName}
            />
          )}
        </StackItem>

        <StackItem size="static">
          <HStack gap={1.5} vAlign="center">
            <StatusDot
              variant={dirty ? "warning" : "success"}
              label={dirty ? "Unsaved changes" : "Saved"}
              tooltip={dirty ? "Saving…" : "All changes saved"}
              isPulsing={dirty}
            />
            <Text type="supporting" color="secondary">
              {dirty ? "Saving…" : "Saved"}
            </Text>
          </HStack>
        </StackItem>

        <StackItem size="fill">
          <div />
        </StackItem>

        <StackItem size="static">
          <HStack gap={1} vAlign="center">
            <IconButton
              label="Undo"
              tooltip="Undo (⌘Z)"
              icon={<UndoIcon />}
              variant="ghost"
              size="sm"
              isDisabled={!canUndo}
              onClick={() => undo()}
            />
            <IconButton
              label="Redo"
              tooltip="Redo (⇧⌘Z)"
              icon={<RedoIcon />}
              variant="ghost"
              size="sm"
              isDisabled={!canRedo}
              onClick={() => redo()}
            />
          </HStack>
        </StackItem>

        <StackItem size="static">
          <HStack gap={1} vAlign="center">
            <IconButton
              label="Zoom out"
              icon={<ZoomOutIcon />}
              variant="ghost"
              size="sm"
              onClick={() => setZoom(zoom / 1.25)}
            />
            <Button
              label="Reset zoom"
              variant="ghost"
              size="sm"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </Button>
            <IconButton
              label="Zoom in"
              icon={<ZoomInIcon />}
              variant="ghost"
              size="sm"
              onClick={() => setZoom(zoom * 1.25)}
            />
          </HStack>
        </StackItem>

        <StackItem size="static">
          <HStack gap={0.5} vAlign="center">
            <Button
              label="Design"
              size="sm"
              variant={mode === "design" ? "secondary" : "ghost"}
              onClick={() => exitLive()}
            />
            <Button
              label="Live"
              size="sm"
              variant={mode === "live" ? "secondary" : "ghost"}
              isDisabled={!bundle}
              onClick={() => void enterLive()}
            />
          </HStack>
        </StackItem>

        <StackItem size="static">
          <div id="ob-run-slot">
            <RunButton />
          </div>
        </StackItem>

        <StackItem size="static">
          <MoreMenu
            label="More project actions"
            size="sm"
            isDisabled={!bundle}
            items={[
              {
                label: "Export .kicad_sch",
                onClick: () => {
                  if (!bundle) return;
                  const { filename, text } = exportProjectToKicad(bundle);
                  downloadText(filename, text, "text/plain");
                },
              },
            ]}
          />
        </StackItem>
      </HStack>
    </div>
  );
}
