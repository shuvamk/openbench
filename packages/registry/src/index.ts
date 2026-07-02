/**
 * @openbench/registry — curated OpenBench component library (Phase 1).
 *
 * Exposes the seven curated parts as validated Component IR documents plus an
 * id lookup. The registry is the single source for `componentId` references
 * in schematics; every entry passes `validateComponent` from
 * @openbench/ir-schema (enforced by this package's tests).
 */
import type { Component } from "@openbench/ir-schema";
import {
  capacitorGeneric,
  esp32Devkit,
  ground,
  ledGeneric,
  resistorGeneric,
  vsourceDc,
  vsourcePulse,
} from "./components";

export const registryComponents: Component[] = [
  resistorGeneric,
  capacitorGeneric,
  ledGeneric,
  vsourceDc,
  vsourcePulse,
  ground,
  esp32Devkit,
];

const componentsById: ReadonlyMap<string, Component> = new Map(
  registryComponents.map((component) => [component.id, component]),
);

export function getComponent(id: string): Component | undefined {
  return componentsById.get(id);
}
