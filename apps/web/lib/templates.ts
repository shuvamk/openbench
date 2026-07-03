import {
  IR_VERSION,
  type Provenance,
  type Project,
  type Schematic,
} from "@openbench/ir-schema";
import type { ProjectBundle } from "./project-store/types";

/** Starter templates offered by the "New project" dialog. */
export type TemplateKind = "blank" | "rc-lowpass" | "esp32-blink" | "playground";

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
 * RC low-pass: V1 (0→5V ~1kHz pulse) → R1 (4.7kΩ) → C1 (100nF) → GND.
 * vin = V1.pos/R1.p1, vout = R1.p2/C1.p1, gnd = C1.p2/V1.neg/GND1.
 * The pulse source defaults (400us on / 1ms period) drive the ~470us RC
 * time constant, so a transient run shows exponential charging on VOUT.
 */
const rcLowpassContent = (): SchematicContent => ({
  instances: [
    { instanceId: "V1", componentId: "cmp_vsource_pulse" },
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

/**
 * Interactive playground (issue #26): one 5V rail feeding three demo branches.
 * A: BTN1 (pushbutton) → R1 (220Ω) → D1 (LED) → GND — press to light the LED.
 * B: POT1 across V1, wiper driving LA1 (lamp) → GND — a dimmer.
 * C: SW1 (SPST) → M1 (DC motor) → GND — a latching motor switch.
 * Layout: source on the left, one horizontal row per branch, GND rail at the
 * bottom, everything snapped to the 20px editor grid.
 */
const playgroundContent = (): SchematicContent => ({
  instances: [
    { instanceId: "V1", componentId: "cmp_vsource_dc" },
    { instanceId: "BTN1", componentId: "cmp_pushbutton" },
    {
      instanceId: "R1",
      componentId: "cmp_resistor_generic",
      parameterOverrides: { resistance: 220 },
    },
    { instanceId: "D1", componentId: "cmp_led_generic" },
    { instanceId: "POT1", componentId: "cmp_potentiometer" },
    { instanceId: "LA1", componentId: "cmp_lamp" },
    { instanceId: "SW1", componentId: "cmp_switch_spst" },
    { instanceId: "M1", componentId: "cmp_dc_motor" },
    { instanceId: "GND1", componentId: "cmp_ground" },
  ],
  nets: [
    {
      netId: "net_vcc",
      name: "VCC",
      connections: [
        { instanceId: "V1", pinId: "pos" },
        { instanceId: "BTN1", pinId: "p1" },
        { instanceId: "POT1", pinId: "p1" },
        { instanceId: "SW1", pinId: "p1" },
      ],
    },
    {
      netId: "net_btn_out",
      name: "BTN_OUT",
      connections: [
        { instanceId: "BTN1", pinId: "p2" },
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
      netId: "net_wiper",
      name: "WIPER",
      connections: [
        { instanceId: "POT1", pinId: "wiper" },
        { instanceId: "LA1", pinId: "p1" },
      ],
    },
    {
      netId: "net_motor",
      name: "MOTOR",
      connections: [
        { instanceId: "SW1", pinId: "p2" },
        { instanceId: "M1", pinId: "p1" },
      ],
    },
    {
      netId: "net_gnd",
      name: "GND",
      connections: [
        { instanceId: "D1", pinId: "cathode" },
        { instanceId: "LA1", pinId: "p2" },
        { instanceId: "POT1", pinId: "p2" },
        { instanceId: "M1", pinId: "p2" },
        { instanceId: "V1", pinId: "neg" },
        { instanceId: "GND1", pinId: "gnd" },
      ],
    },
  ],
  layout: {
    instances: {
      V1: { x: 120, y: 260, rotation: 0 },
      // branch A (top row)
      BTN1: { x: 300, y: 120, rotation: 0 },
      R1: { x: 460, y: 120, rotation: 90 },
      D1: { x: 620, y: 120, rotation: 0 },
      // branch B (middle row)
      POT1: { x: 300, y: 260, rotation: 0 },
      LA1: { x: 460, y: 260, rotation: 0 },
      // branch C (bottom row)
      SW1: { x: 300, y: 400, rotation: 0 },
      M1: { x: 460, y: 400, rotation: 0 },
      // shared ground rail below everything
      GND1: { x: 380, y: 520, rotation: 0 },
    },
  },
});

const contentByKind: Record<TemplateKind, () => SchematicContent> = {
  blank: blankContent,
  "rc-lowpass": rcLowpassContent,
  "esp32-blink": esp32BlinkContent,
  playground: playgroundContent,
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
