/**
 * @openbench/registry — curated OpenBench component library.
 *
 * Exposes the curated parts (Phase 1, issue #6; ten real-world parts,
 * issue #22) as validated Component IR documents plus an id lookup. The
 * registry is the single source for `componentId` references in schematics;
 * every entry passes `validateComponent` from @openbench/ir-schema (enforced
 * by this package's tests).
 */
import type { Component } from "@openbench/ir-schema";
import {
  buzzer,
  capacitorGeneric,
  dcMotor,
  diodeGeneric,
  esp32Devkit,
  ground,
  inductorGeneric,
  isourceDc,
  isourceSin,
  lamp,
  ldr,
  ledGeneric,
  nmos2n7000,
  npn2n2222,
  opampIdeal,
  pnp2n3906,
  potentiometer,
  pushbutton,
  resistorGeneric,
  rgbLed,
  schottkyDiode,
  switchSpst,
  tmp36,
  vsourceDc,
  vsourcePulse,
  vsourceSin,
  zenerDiode,
} from "./components";

export const registryComponents: Component[] = [
  resistorGeneric,
  capacitorGeneric,
  ledGeneric,
  vsourceDc,
  vsourcePulse,
  diodeGeneric,
  npn2n2222,
  potentiometer,
  pushbutton,
  switchSpst,
  dcMotor,
  buzzer,
  lamp,
  rgbLed,
  ldr,
  inductorGeneric,
  vsourceSin,
  zenerDiode,
  schottkyDiode,
  pnp2n3906,
  nmos2n7000,
  opampIdeal,
  tmp36,
  isourceDc,
  isourceSin,
  ground,
  esp32Devkit,
];

const componentsById: ReadonlyMap<string, Component> = new Map(
  registryComponents.map((component) => [component.id, component]),
);

export function getComponent(id: string): Component | undefined {
  return componentsById.get(id);
}
