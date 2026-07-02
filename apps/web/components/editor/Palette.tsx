"use client";

import React from "react";
import type { Component } from "@openbench/ir-schema";
import { registryComponents } from "@openbench/registry";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useEditorStore } from "../../lib/editor/store";
import { SymbolPreview } from "./symbols";

const CATEGORY_LABELS: Record<string, string> = {
  passive: "Passives",
  active: "Active",
  connector: "Connectors",
  mcu: "Microcontrollers",
  power: "Power",
  sensor: "Sensors",
  other: "Other",
};

function groupByCategory(components: Component[]): Array<[string, Component[]]> {
  const groups = new Map<string, Component[]>();
  for (const component of components) {
    const list = groups.get(component.category) ?? [];
    list.push(component);
    groups.set(component.category, list);
  }
  return [...groups.entries()];
}

/** Left rail: registry components, click to arm the place tool. */
export function Palette() {
  const setTool = useEditorStore((s) => s.setTool);
  const placingComponentId = useEditorStore((s) => s.placingComponentId);

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        overflowY: "auto",
        borderRight: "1px solid var(--ob-canvas-grid)",
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <VStack gap={4}>
        <Text type="label" color="secondary">
          Components
        </Text>
        {groupByCategory(registryComponents).map(([category, components]) => (
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
        ))}
        <Text type="supporting" color="secondary">
          Click a part, then double-click the canvas to place it.
        </Text>
      </VStack>
    </div>
  );
}
