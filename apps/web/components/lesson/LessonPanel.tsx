"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useEditorStore } from "../../lib/editor/store";
import { buildPreviewLesson } from "../../lib/lesson/preview";
import { LessonAuthorPanel } from "./LessonAuthorPanel";
import { StudentRunnerPanel } from "./StudentRunnerPanel";

type TeachingView = "author" | "student";

/**
 * Teaching chrome for the editor (issue #163): the single mount site that makes
 * the authored-walkthrough flow reachable from the editor. Self-gates on the
 * editor store's `teachingOpen` flag — like {@link ../editor/ErcPanel} — so the
 * editor page mounts it unconditionally and the EditorTopBar toggle just flips
 * the flag.
 *
 * When open it shows two views against the *live* editor store, toggled in
 * place: the {@link LessonAuthorPanel} (derive→refine the lesson from the build)
 * and the {@link StudentRunnerPanel} run against a preview lesson wrapped from
 * the current bundle via {@link buildPreviewLesson}, so an author can jump
 * straight from authoring to previewing the student experience without a share
 * round-trip.
 */
export function LessonPanel(): React.JSX.Element | null {
  const teachingOpen = useEditorStore((s) => s.teachingOpen);
  const bundle = useEditorStore((s) => s.bundle);
  const past = useEditorStore((s) => s.past);
  const [view, setView] = useState<TeachingView>("author");

  const previewLesson = useMemo(
    () => (bundle ? buildPreviewLesson(bundle, past) : null),
    [bundle, past],
  );

  if (!teachingOpen) return null;

  return (
    <div
      data-testid="lesson-panel"
      style={{
        flexShrink: 0,
        width: 320,
        overflowY: "auto",
        padding: "12px 16px",
        boxSizing: "border-box",
        borderLeft: "1px solid var(--ob-canvas-grid)",
      }}
    >
      <VStack gap={2}>
      <HStack gap={1} align="center">
        <Text type="label" color="secondary">
          Teaching
        </Text>
        <HStack gap={0.5}>
          <Button
            label="Author"
            size="sm"
            variant={view === "author" ? "secondary" : "ghost"}
            onClick={() => setView("author")}
          />
          <Button
            label="Student"
            size="sm"
            variant={view === "student" ? "secondary" : "ghost"}
            onClick={() => setView("student")}
          />
        </HStack>
      </HStack>

      {view === "author" ? (
        <LessonAuthorPanel />
      ) : previewLesson ? (
        <StudentRunnerPanel lesson={previewLesson} />
      ) : (
        <Text type="supporting" color="secondary">
          Open a project to preview it as a student.
        </Text>
      )}
      </VStack>
    </div>
  );
}
