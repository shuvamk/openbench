import {
  IR_VERSION,
  type Provenance,
  type Project,
  type Schematic,
} from "@openbench/ir-schema";
import type { ProjectBundle } from "./project-store/types";

/** Starter templates offered by the "New project" dialog. */
export type TemplateKind = "blank" | "rc-lowpass" | "esp32-blink";

const stamp = (): Provenance => ({
  source: "frontend",
  at: new Date().toISOString(),
});

/** Random id suffix matching the IR id charset (`[a-z0-9_-]+`). */
const idSuffix = (): string => crypto.randomUUID();

type SchematicContent = Pick<Schematic, "instances" | "nets"> & {
  layout?: Schematic["layout"];
};

const blankContent = (): SchematicContent => ({ instances: [], nets: [] });

/**
 * RC low-pass: V1 (5V DC) → R1 (4.7kΩ) → C1 (100nF) → GND.
 * vin = V1.pos/R1.p1, vout = R1.p2/C1.p1, gnd = C1.p2/V1.neg/GND1.
 */
const rcLowpassContent = (): SchematicContent => ({
  instances: [
    { instanceId: "V1", componentId: "cmp_vsource_dc" },
    {
      instanceId: "R1",
      componentId: "cmp_resistor_generic",
      parameterOverrides: { resistance: 4700 },
    },
    {
      instanceId: "C1",
      componentId: "cmp_capacitor_generic",
      parameterOverrides: { capacitance: 100e-9 },
    },
    { instanceId: "GND1", componentId: "cmp_ground" },
  ],
  nets: [
    {
      netId: "net_vin",
      name: "VIN",
      connections: [
        { instanceId: "V1", pinId: "pos" },
        { instanceId: "R1", pinId: "p1" },
      ],
    },
    {
      netId: "net_vout",
      name: "VOUT",
      connections: [
        { instanceId: "R1", pinId: "p2" },
        { instanceId: "C1", pinId: "p1" },
      ],
    },
    {
      netId: "net_gnd",
      name: "GND",
      connections: [
        { instanceId: "C1", pinId: "p2" },
        { instanceId: "V1", pinId: "neg" },
        { instanceId: "GND1", pinId: "gnd" },
      ],
    },
  ],
  layout: {
    instances: {
      V1: { x: 120, y: 160, rotation: 0 },
      R1: { x: 280, y: 100, rotation: 90 },
      C1: { x: 440, y: 160, rotation: 0 },
      GND1: { x: 280, y: 280, rotation: 0 },
    },
  },
});

/** ESP32 blink: U1.GPIO2 → R1 (220Ω) → D1 (LED) → GND. */
const esp32BlinkContent = (): SchematicContent => ({
  instances: [
    { instanceId: "U1", componentId: "cmp_esp32_devkit" },
    {
      instanceId: "R1",
      componentId: "cmp_resistor_generic",
      parameterOverrides: { resistance: 220 },
    },
    { instanceId: "D1", componentId: "cmp_led_generic" },
    { instanceId: "GND1", componentId: "cmp_ground" },
  ],
  nets: [
    {
      netId: "net_gpio2",
      name: "GPIO2",
      connections: [
        { instanceId: "U1", pinId: "GPIO2" },
        { instanceId: "R1", pinId: "p1" },
      ],
    },
    {
      netId: "net_led_a",
      name: "LED_A",
      connections: [
        { instanceId: "R1", pinId: "p2" },
        { instanceId: "D1", pinId: "anode" },
      ],
    },
    {
      netId: "net_gnd",
      name: "GND",
      connections: [
        { instanceId: "D1", pinId: "cathode" },
        { instanceId: "U1", pinId: "GND" },
        { instanceId: "GND1", pinId: "gnd" },
      ],
    },
  ],
  layout: {
    instances: {
      U1: { x: 120, y: 120, rotation: 0 },
      R1: { x: 360, y: 120, rotation: 90 },
      D1: { x: 480, y: 200, rotation: 0 },
      GND1: { x: 480, y: 320, rotation: 0 },
    },
  },
});

const contentByKind: Record<TemplateKind, () => SchematicContent> = {
  blank: blankContent,
  "rc-lowpass": rcLowpassContent,
  "esp32-blink": esp32BlinkContent,
};

/** Build a fresh, valid ProjectBundle from a starter template. */
export function createFromTemplate(kind: TemplateKind, name: string): ProjectBundle {
  const projectId = `proj_${idSuffix()}`;
  const schematicId = `sch_${idSuffix()}`;
  const content = contentByKind[kind]();

  const schematic: Schematic = {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: schematicId,
    projectId,
    instances: content.instances,
    nets: content.nets,
    ...(content.layout !== undefined ? { layout: content.layout } : {}),
    provenance: stamp(),
  };

  const project: Project = {
    irVersion: IR_VERSION,
    kind: "project",
    id: projectId,
    name,
    schematicId,
    collaborators: [],
    provenance: stamp(),
  };

  return { project, schematic };
}

/**
 * Deep-copy a bundle under fresh ids and a new name. Simulation runs and
 * firmware targets are NOT carried over — they reference the old document
 * ids and are re-derivable from the schematic.
 */
export function duplicateBundle(bundle: ProjectBundle, name: string): ProjectBundle {
  const projectId = `proj_${idSuffix()}`;
  const schematicId = `sch_${idSuffix()}`;
  const source: ProjectBundle = JSON.parse(JSON.stringify(bundle)) as ProjectBundle;

  const schematic: Schematic = {
    ...source.schematic,
    id: schematicId,
    projectId,
    provenance: stamp(),
  };

  const {
    firmwareTargetId: _firmwareTargetId,
    latestSimulationRunId: _latestSimulationRunId,
    ...projectRest
  } = source.project;
  const project: Project = {
    ...projectRest,
    id: projectId,
    name,
    schematicId,
    provenance: stamp(),
  };

  return { project, schematic };
}
