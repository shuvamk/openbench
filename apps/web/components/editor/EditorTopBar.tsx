"use client";

import React, { useState } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { HStack, StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEditorStore } from "../../lib/editor/store";
import { RunButton } from "../sim/RunButton";

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

  const [draftName, setDraftName] = useState<string | null>(null);

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
          <div id="ob-run-slot">
            <RunButton />
          </div>
        </StackItem>
      </HStack>
    </div>
  );
}
