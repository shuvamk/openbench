"use client";

import React from "react";
import type { Component, ComponentParameter } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { Divider } from "@astryxdesign/core/Divider";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import { useEditorStore } from "../../lib/editor/store";
import { ErcPanel } from "./ErcPanel";
import { LearnPanel } from "./LearnPanel";

/** Right rail: selected instance details, parameter editing, connected nets. */
export function Inspector() {
  const bundle = useEditorStore((s) => s.bundle);
  const selection = useEditorStore((s) => s.selection);
  const setParameter = useEditorStore((s) => s.setParameter);

  const schematic = bundle?.schematic;
  const instanceId = selection[0];
  const instance = schematic?.instances.find((i) => i.instanceId === instanceId);
  const component = instance ? getComponent(instance.componentId) : undefined;

  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        overflowY: "auto",
        borderLeft: "1px solid var(--ob-canvas-grid)",
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <VStack gap={4}>
        {/* Circuit-wide ERC issues, always on top; self-hides when clean. */}
        <ErcPanel />
        {/* Contextual learning for the selected part; self-hides when absent/off. */}
        <LearnPanel />
        {!instance || !component || !schematic ? (
        <VStack gap={2}>
          <Text type="label" color="secondary">
            Inspector
          </Text>
          <Text type="supporting" color="secondary">
            {selection.length > 1
              ? `${selection.length} instances selected`
              : "Select an instance to edit its parameters."}
          </Text>
        </VStack>
      ) : (
        <VStack gap={4}>
          <VStack gap={0.5}>
            <Text type="display-3">{instance.instanceId}</Text>
            <Text type="supporting" color="secondary">
              {component.name}
            </Text>
          </VStack>

          {component.parameters.length > 0 && (
            <VStack gap={2}>
              <Text type="label" color="secondary">
                Parameters
              </Text>
              {component.parameters.map((parameter) => (
                <ParameterField
                  key={parameter.name}
                  parameter={parameter}
                  component={component}
                  value={instance.parameterOverrides?.[parameter.name]}
                  onChange={(value) => setParameter(instance.instanceId, parameter.name, value)}
                />
              ))}
            </VStack>
          )}

          <Divider />

          <VStack gap={1.5}>
            <Text type="label" color="secondary">
              Nets
            </Text>
            {schematic.nets
              .filter((net) => net.connections.some((c) => c.instanceId === instance.instanceId))
              .map((net) => (
                <VStack key={net.netId} gap={0}>
                  <Text type="body">{net.name ?? net.netId}</Text>
                  <Text type="supporting" color="secondary">
                    {net.connections
                      .filter((c) => c.instanceId === instance.instanceId)
                      .map((c) => pinName(component, c.pinId))
                      .join(", ")}{" "}
                    · {net.connections.length} connection{net.connections.length === 1 ? "" : "s"}
                  </Text>
                </VStack>
              ))}
            {schematic.nets.every(
              (net) => !net.connections.some((c) => c.instanceId === instance.instanceId),
            ) && (
              <Text type="supporting" color="secondary">
                Not connected yet — click a pin to start a wire.
              </Text>
            )}
          </VStack>
        </VStack>
      )}
      </VStack>
    </div>
  );
}

function pinName(component: Component, pinId: string): string {
  return component.pins.find((p) => p.id === pinId)?.name ?? pinId;
}

function ParameterField({
  parameter,
  value,
  onChange,
}: {
  parameter: ComponentParameter;
  component: Component;
  value: number | string | boolean | undefined;
  onChange: (value: number | string | boolean) => void;
}) {
  if (parameter.type === "number") {
    const current =
      typeof value === "number" ? value : typeof parameter.default === "number" ? parameter.default : 0;
    return (
      <NumberInput
        label={parameter.name}
        value={current}
        onChange={(next) => onChange(next)}
        {...(parameter.unit ? { units: parameter.unit } : {})}
        step={null}
      />
    );
  }
  if (parameter.type === "boolean") {
    const current = typeof value === "boolean" ? value : parameter.default === true;
    return <Switch label={parameter.name} value={current} onChange={(next) => onChange(next)} />;
  }
  const current = typeof value === "string" ? value : String(parameter.default);
  return <TextInput label={parameter.name} value={current} onChange={(next) => onChange(next)} />;
}
