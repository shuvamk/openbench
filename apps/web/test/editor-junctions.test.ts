import { describe, expect, it } from "vitest";
import { IR_VERSION, type Component, type Net, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import {
  computeJunctions,
  getPinPosition,
  orthogonalPoints,
  type Point,
} from "../lib/editor/geometry";

/**
 * Junction dots (issue #129): a filled dot belongs where the wires of ONE net
 * form a genuine multi-way join. Wires are routed as a STAR from the net's
 * first connection out to every other pin (`netWireSegments` in
 * SchematicCanvas), so an N-pin net emits N-1 segments that all share the
 * anchor endpoint. The anchor therefore appears as a coincident endpoint
 * (N-1) times: a 3-pin tee gives it degree 2. `computeJunctions` must dot any
 * within-net coordinate where >= 2 segment endpoints coincide (the anchor is
 * itself a connection), and only true endpoints count — intermediate bend
 * vertices never form a junction.
 */

/**
 * Rebuild the exact segment list `netWireSegments` produces for a net: star
 * routing from the first connection's pin to each remaining pin, via
 * `orthogonalPoints`. Mirrors the private helper so the test drives real
 * routing output, not a hand-built fixture the router could never emit.
 */
function realNetWireSegments(schematic: Schematic, net: Net): Point[][] {
  const positions: Point[] = [];
  for (const connection of net.connections) {
    const instance = schematic.instances.find((i) => i.instanceId === connection.instanceId);
    const component: Component | undefined = instance
      ? getComponent(instance.componentId)
      : undefined;
    if (!instance || !component) continue;
    positions.push(getPinPosition(schematic, component, instance.instanceId, connection.pinId));
  }
  const [first, ...rest] = positions;
  if (!first) return [];
  return rest.map((target) => orthogonalPoints(first, target));
}

/** Schematic whose net_gnd is a real 3-pin tee (V1.neg, C1.p2, GND1.gnd). */
function teeSchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_tee",
    projectId: "proj_tee",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "R1", componentId: "cmp_resistor_generic" },
      { instanceId: "C1", componentId: "cmp_capacitor_generic" },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    nets: [
      {
        netId: "net_in",
        name: "IN",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_gnd",
        name: "GND",
        connections: [
          { instanceId: "V1", pinId: "neg" },
          { instanceId: "C1", pinId: "p2" },
          { instanceId: "GND1", pinId: "gnd" },
        ],
      },
    ],
    layout: {
      instances: {
        V1: { x: 100, y: 200, rotation: 0 },
        R1: { x: 240, y: 120, rotation: 0 },
        C1: { x: 380, y: 200, rotation: 90 },
        GND1: { x: 100, y: 320, rotation: 0 },
      },
    },
    provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
  };
}

function netById(schematic: Schematic, netId: string): Net {
  const net = schematic.nets.find((n) => n.netId === netId);
  if (!net) throw new Error(`no net ${netId}`);
  return net;
}

describe("computeJunctions over real star-routed netWireSegments", () => {
  it("produces exactly one junction at a genuine 3-pin tee, on the anchor pin", () => {
    const schematic = teeSchematic();
    const gnd = netById(schematic, "net_gnd");
    const segments = realNetWireSegments(schematic, gnd);
    // Star routing: 3 pins -> 2 segments, both anchored on the first pin.
    expect(segments).toHaveLength(2);

    const anchor = getPinPosition(
      schematic,
      getComponent("cmp_vsource_dc")!,
      "V1",
      "neg",
    );
    const junctions = computeJunctions(segments);
    expect(junctions).toHaveLength(1);
    expect(junctions[0]).toEqual(anchor);
  });

  it("produces no junction for a real 2-pin net", () => {
    const schematic = teeSchematic();
    const inNet = netById(schematic, "net_in");
    const segments = realNetWireSegments(schematic, inNet);
    expect(segments).toHaveLength(1);
    expect(computeJunctions(segments)).toEqual([]);
  });
});

/**
 * Pure-geometry edge cases (independent of routing): corners, bend vertices,
 * and cross-net crossovers must never yield a dot.
 */
describe("computeJunctions edge cases", () => {
  it("does not dot a single segment with an interior bend vertex", () => {
    // One orthogonal segment turning a corner: its two ENDPOINTS are distinct
    // and each appears once -> no junction.
    const segments: Point[][] = [
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 10 },
      ],
    ];
    expect(computeJunctions(segments)).toEqual([]);
  });

  it("counts intermediate bend vertices as non-endpoints (no false junction)", () => {
    // Three segments routing their MIDDLE bend through a shared coordinate
    // must not create a junction there; only endpoints count.
    const shared: Point = { x: 5, y: 5 };
    const segments: Point[][] = [
      [{ x: 0, y: 5 }, shared, { x: 10, y: 10 }],
      [{ x: 5, y: 0 }, shared, { x: 11, y: 12 }],
      [{ x: 1, y: 5 }, shared, { x: 12, y: 14 }],
    ];
    expect(computeJunctions(segments)).toEqual([]);
  });

  it("crossing segments of different nets produce no shared junction", () => {
    const netA: Point[][] = [
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
    ];
    const netB: Point[][] = [
      [
        { x: 0, y: -10 },
        { x: 0, y: 10 },
      ],
    ];
    // They geometrically cross at (0,0), but that point is an endpoint of
    // neither net's segment, and nets are evaluated independently.
    expect(computeJunctions(netA)).toEqual([]);
    expect(computeJunctions(netB)).toEqual([]);
  });
});
