import type {
  Component,
  Net,
  NetConnection,
  Schematic,
  SchematicInstance,
} from "@openbench/ir-schema";

/**
 * Pure, immutable schematic mutations. Every function returns a NEW schematic
 * that still passes `validateSchematic` — the zustand store (./store) wraps
 * these with dirty-tracking and debounced persistence, and tests exercise
 * them directly.
 */

export const GRID = 10;

export function snapToGrid(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export interface Point {
  x: number;
  y: number;
}

type Rotation = 0 | 90 | 180 | 270;

/**
 * Reference-designator prefix per component kind (issue #12):
 * R/C/D/V come from the SPICE template's leading letters, MCUs are U,
 * ground stays GND. Unknown parts fall back to U.
 */
export function refPrefix(component: Component): string {
  if (component.category === "mcu") return "U";
  const template = component.simModel?.template;
  const match = template?.match(/^([A-Za-z]+)\{ref\}/);
  if (match?.[1]) return match[1].toUpperCase();
  if (component.category === "power" && !component.simModel) return "GND";
  return "U";
}

function nextInstanceId(schematic: Schematic, prefix: string): string {
  let max = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const instance of schematic.instances) {
    const match = instance.instanceId.match(pattern);
    if (match?.[1]) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `${prefix}${max + 1}`;
}

function withLayoutEntry(
  schematic: Schematic,
  instanceId: string,
  entry: { x: number; y: number; rotation?: Rotation },
): Schematic {
  return {
    ...schematic,
    layout: {
      instances: {
        ...(schematic.layout?.instances ?? {}),
        [instanceId]: entry,
      },
    },
  };
}

export interface PlaceResult {
  schematic: Schematic;
  instanceId: string;
}

/** Add a registry component at (snapped) position; generates R1/C1/… ids. */
export function placeInstance(
  schematic: Schematic,
  component: Component,
  position: Point,
): PlaceResult {
  const instanceId = nextInstanceId(schematic, refPrefix(component));
  const instance: SchematicInstance = {
    instanceId,
    componentId: component.id,
  };
  const withInstance: Schematic = {
    ...schematic,
    instances: [...schematic.instances, instance],
  };
  return {
    schematic: withLayoutEntry(withInstance, instanceId, {
      x: snapToGrid(position.x),
      y: snapToGrid(position.y),
      rotation: 0,
    }),
    instanceId,
  };
}

/** Move an instance's layout entry, snapped to the grid. Unknown ids are a no-op. */
export function moveInstance(
  schematic: Schematic,
  instanceId: string,
  position: Point,
): Schematic {
  if (!schematic.instances.some((i) => i.instanceId === instanceId)) return schematic;
  const previous = schematic.layout?.instances[instanceId];
  return withLayoutEntry(schematic, instanceId, {
    x: snapToGrid(position.x),
    y: snapToGrid(position.y),
    ...(previous?.rotation !== undefined ? { rotation: previous.rotation } : {}),
  });
}

/** Rotate an instance by +90 degrees (wraps 270 -> 0). */
export function rotateInstance(schematic: Schematic, instanceId: string): Schematic {
  if (!schematic.instances.some((i) => i.instanceId === instanceId)) return schematic;
  const previous = schematic.layout?.instances[instanceId];
  const rotation = ((((previous?.rotation ?? 0) + 90) % 360) as Rotation);
  return withLayoutEntry(schematic, instanceId, {
    x: previous?.x ?? 0,
    y: previous?.y ?? 0,
    rotation,
  });
}

function sameConnection(a: NetConnection, b: NetConnection): boolean {
  return a.instanceId === b.instanceId && a.pinId === b.pinId;
}

function findNetIndex(schematic: Schematic, pin: NetConnection): number {
  return schematic.nets.findIndex((net) =>
    net.connections.some((connection) => sameConnection(connection, pin)),
  );
}

function nextNetId(schematic: Schematic): string {
  let max = 0;
  for (const net of schematic.nets) {
    const match = net.netId.match(/^net_(\d+)$/);
    if (match?.[1]) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `net_${max + 1}`;
}

/**
 * Connect two pins: creates a fresh net, joins one pin into the other's
 * existing net, or merges two nets (re-pointing every connection of the
 * absorbed net into the survivor and dropping the absorbed net).
 */
export function connectPins(
  schematic: Schematic,
  a: NetConnection,
  b: NetConnection,
): Schematic {
  if (sameConnection(a, b)) return schematic;
  const aIndex = findNetIndex(schematic, a);
  const bIndex = findNetIndex(schematic, b);

  if (aIndex === -1 && bIndex === -1) {
    const net: Net = { netId: nextNetId(schematic), connections: [{ ...a }, { ...b }] };
    return { ...schematic, nets: [...schematic.nets, net] };
  }

  if (aIndex === bIndex) return schematic; // already on the same net

  if (aIndex === -1 || bIndex === -1) {
    const netIndex = aIndex === -1 ? bIndex : aIndex;
    const loosePin = aIndex === -1 ? a : b;
    const nets = schematic.nets.map((net, index) =>
      index === netIndex
        ? { ...net, connections: [...net.connections, { ...loosePin }] }
        : net,
    );
    return { ...schematic, nets };
  }

  // Merge: keep a's net, absorb b's net.
  const survivor = schematic.nets[aIndex]!;
  const absorbed = schematic.nets[bIndex]!;
  const mergedConnections = [...survivor.connections];
  for (const connection of absorbed.connections) {
    if (!mergedConnections.some((existing) => sameConnection(existing, connection))) {
      mergedConnections.push({ ...connection });
    }
  }
  const nets = schematic.nets
    .filter((_, index) => index !== bIndex)
    .map((net) =>
      net.netId === survivor.netId ? { ...net, connections: mergedConnections } : net,
    );
  return { ...schematic, nets };
}

/**
 * Remove instances plus their net connections, drop nets that become empty,
 * and clean up their layout entries.
 */
export function deleteSelection(schematic: Schematic, instanceIds: string[]): Schematic {
  const doomed = new Set(instanceIds);
  if (!schematic.instances.some((i) => doomed.has(i.instanceId))) return schematic;

  const instances = schematic.instances.filter((i) => !doomed.has(i.instanceId));
  const nets = schematic.nets
    .map((net) => ({
      ...net,
      connections: net.connections.filter((c) => !doomed.has(c.instanceId)),
    }))
    .filter((net) => net.connections.length > 0);

  let layout = schematic.layout;
  if (layout) {
    const remaining: Record<string, { x: number; y: number; rotation?: Rotation }> = {};
    for (const [instanceId, entry] of Object.entries(layout.instances)) {
      if (!doomed.has(instanceId)) remaining[instanceId] = entry;
    }
    layout = { instances: remaining };
  }

  return { ...schematic, instances, nets, ...(layout ? { layout } : {}) };
}

/** Set (or clear, with `undefined`) a parameter override on an instance. */
export function setParameterOverride(
  schematic: Schematic,
  instanceId: string,
  parameterName: string,
  value: number | string | boolean | undefined,
): Schematic {
  const instances = schematic.instances.map((instance) => {
    if (instance.instanceId !== instanceId) return instance;
    const overrides = { ...(instance.parameterOverrides ?? {}) };
    if (value === undefined) {
      delete overrides[parameterName];
    } else {
      overrides[parameterName] = value;
    }
    if (Object.keys(overrides).length === 0) {
      const { parameterOverrides: _dropped, ...rest } = instance;
      return rest;
    }
    return { ...instance, parameterOverrides: overrides };
  });
  return { ...schematic, instances };
}
