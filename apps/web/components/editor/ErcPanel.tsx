"use client";

import React, { useMemo } from "react";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useEditorStore } from "../../lib/editor/store";
import { deriveErcIssues, type ErcIssue } from "../../lib/editor/erc";

/**
 * Inspector "Issues" panel (issue #71): a circuit-wide, always-visible list of
 * electrical-rule-check violations in plain language. Each row is clickable and
 * selects the offending instance so a beginner can jump straight to the problem
 * ("why won't my LED glow?"). Derived and memoized off the current schematic.
 */
export function ErcPanel() {
  const schematic = useEditorStore((s) => s.bundle?.schematic);
  const setSelection = useEditorStore((s) => s.setSelection);

  const issues = useMemo(() => (schematic ? deriveErcIssues(schematic) : []), [schematic]);

  if (issues.length === 0) return null;

  const errorCount = issues.filter((i) => i.severity === "error").length;

  return (
    <VStack gap={1.5}>
      <HStack gap={1} align="center">
        <Text type="label" color="secondary">
          Issues
        </Text>
        <Text type="supporting" color={errorCount > 0 ? "accent" : "secondary"}>
          {issues.length}
        </Text>
      </HStack>

      <VStack gap={1}>
        {issues.map((issue, index) => (
          <IssueRow key={`${issue.severity}-${index}`} issue={issue} onSelect={setSelection} />
        ))}
      </VStack>
    </VStack>
  );
}

function IssueRow({
  issue,
  onSelect,
}: {
  issue: ErcIssue;
  onSelect: (ids: string[]) => void;
}) {
  const selectable = issue.primaryInstanceId !== undefined;
  const select = () => {
    if (issue.primaryInstanceId) onSelect([issue.primaryInstanceId]);
  };

  return (
    <button
      type="button"
      data-erc-issue
      data-erc-severity={issue.severity}
      {...(issue.primaryInstanceId ? { "data-erc-instance": issue.primaryInstanceId } : {})}
      onClick={select}
      disabled={!selectable}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "transparent",
        padding: "4px 0",
        cursor: selectable ? "pointer" : "default",
        font: "inherit",
      }}
    >
      <HStack gap={1} align="start">
        <StatusDot
          variant={issue.severity === "error" ? "error" : "warning"}
          label={issue.severity === "error" ? "Error" : "Warning"}
        />
        <Text type="supporting" color="primary">
          {issue.message}
        </Text>
      </HStack>
    </button>
  );
}
