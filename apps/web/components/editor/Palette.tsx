"use client";

import React, { useMemo, useState } from "react";
import type { Component } from "@openbench/ir-schema";
import { registryComponents } from "@openbench/registry";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEditorStore } from "../../lib/editor/store";
import {
  CATEGORY_LABELS,
  filterComponents,
} from "../../lib/editor/palette-filter";
import { SymbolPreview } from "./symbols";

function groupByCategory(components: Component[]): Array<[string, Component[]]> {
  const groups = new Map<string, Component[]>();
  for (const component of components) {
    const list = groups.get(component.category) ?? [];
    list.push(component);
    groups.set(component.category, list);
  }
  return [...groups.entries()];
}

/** Components tab: search + the registry part list, click to arm the place tool. */
function ComponentsTab() {
  const setTool = useEditorStore((s) => s.setTool);
  const placingComponentId = useEditorStore((s) => s.placingComponentId);
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () => groupByCategory(filterComponents(registryComponents, query)),
    [query],
  );

  return (
    <VStack gap={4}>
      <TextInput
        label="Search components"
        isLabelHidden
        size="sm"
        startIcon="search"
        hasClear
        placeholder="Search parts…"
        value={query}
        onChange={setQuery}
      />
      {groups.length === 0 ? (
        <Text type="supporting" color="secondary">
          No parts match “{query}”.
        </Text>
      ) : (
        groups.map(([category, components]) => (
          <VStack key={category} gap={1.5}>
            <Text type="supporting" color="secondary">
              {CATEGORY_LABELS[category] ?? category}
            </Text>
            {components.map((component) => (
              <ClickableCard
                key={component.id}
                label={component.name}
                padding={1.5}
                variant={placingComponentId === component.id ? "blue" : "transparent"}
                onClick={() => setTool("place", component.id)}
              >
                <HStack gap={2} vAlign="center">
                  <StackItem size="static">
                    <SymbolPreview component={component} />
                  </StackItem>
                  <StackItem size="fill">
                    <Text type="body">{component.name}</Text>
                  </StackItem>
                </HStack>
              </ClickableCard>
            ))}
          </VStack>
        ))
      )}
      <Text type="supporting" color="secondary">
        Click a part, then double-click the canvas to place it.
      </Text>
    </VStack>
  );
}

/** Instruments tab: measurement tools that attach to the schematic. */
function InstrumentsTab() {
  const setTool = useEditorStore((s) => s.setTool);
  const tool = useEditorStore((s) => s.tool);

  return (
    <VStack gap={4}>
      <ClickableCard
        label="Scope probe"
        padding={1.5}
        variant={tool === "probe" ? "blue" : "transparent"}
        onClick={() => setTool("probe")}
      >
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <Text type="body">🔬 Scope probe</Text>
          </StackItem>
        </HStack>
      </ClickableCard>
      <Text type="supporting" color="secondary">
        Then click a wire to watch that net in the waveform viewer.
      </Text>
    </VStack>
  );
}

/** Left rail: Components | Instruments tabs (parts to place vs. measurement tools). */
export function Palette() {
  const [tab, setTab] = useState("components");

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--ob-canvas-grid)",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <TabList value={tab} onChange={setTab} size="sm" hasDivider>
        <Tab value="components" label="Components" />
        <Tab value="instruments" label="Instruments" />
      </TabList>
      <div style={{ overflowY: "auto", padding: 12, boxSizing: "border-box" }}>
        {tab === "components" && <ComponentsTab />}
        {tab === "instruments" && <InstrumentsTab />}
      </div>
    </div>
  );
}
