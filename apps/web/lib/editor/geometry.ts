import type { Component, Schematic } from "@openbench/ir-schema";
import { refPrefix, type Point } from "./mutations";
import { clampZoom, MAX_ZOOM } from "./store";

export type { Point };

/**
 * Symbol geometry shared by the canvas renderer and wire routing. All pin
 * offsets are in world units relative to the instance origin (the symbol
 * center), before rotation.
 */

export type SymbolKind =
  | "resistor"
  | "capacitor"
  | "led"
  | "vsource"
  | "ground"
  | "mcu"
  | "diode"
  | "npn"
  | "potentiometer"
  | "pushbutton"
  | "switch"
  | "motor"
  | "buzzer"
  | "lamp"
  | "rgbled"
  | "ldr"
  | "inductor"
  | "acsource"
  | "zener"
  | "schottky"
  | "pnp"
  | "nmos"
  | "opamp"
  | "ic"
  | "isource"
  | "generic";

/** Curated parts get dedicated symbols keyed by id (issue #23). */
const ID_KINDS: Record<string, SymbolKind> = {
  cmp_diode_generic: "diode",
  cmp_npn_2n2222: "npn",
  cmp_potentiometer: "potentiometer",
  cmp_pushbutton: "pushbutton",
  cmp_switch_spst: "switch",
  cmp_dc_motor: "motor",
  cmp_buzzer: "buzzer",
  cmp_lamp: "lamp",
  cmp_rgb_led: "rgbled",
  cmp_ldr: "ldr",
  cmp_led_generic: "led",
  cmp_inductor_generic: "inductor",
  cmp_vsource_sin: "acsource",
  cmp_zener_diode: "zener",
  cmp_schottky_diode: "schottky",
  cmp_pnp_2n3906: "pnp",
  cmp_nmos_2n7000: "nmos",
  cmp_opamp_ideal: "opamp",
  cmp_tmp36: "ic",
  cmp_logic_7400: "ic",
  cmp_logic_7404: "ic",
  cmp_logic_7408: "ic",
  cmp_7segment_display: "ic",
};

export function getSymbolKind(component: Component): SymbolKind {
  const byId = ID_KINDS[component.id];
  if (byId) return byId;
  if (component.category === "mcu") return "mcu";
  switch (refPrefix(component)) {
    case "R":
      return "resistor";
    case "C":
      return "capacitor";
    case "D":
      return "led";
    case "V":
      return "vsource";
    case "I":
      return "isource";
    case "GND":
      return "ground";
    default:
      return "generic";
  }
}

export interface SymbolGeometry {
  /** Half-extents of the symbol's bounding box (centered at origin). */
  halfWidth: number;
  halfHeight: number;
  /** Pin offsets relative to the symbol center, pre-rotation. */
  pins: Record<string, Point>;
}

function twoPinHorizontal(component: Component, reach: number): Record<string, Point> {
  const [first, second] = component.pins;
  const pins: Record<string, Point> = {};
  if (first) pins[first.id] = { x: -reach, y: 0 };
  if (second) pins[second.id] = { x: reach, y: 0 };
  return pins;
}

/** Explicit per-pin-id anchors; missing declared ids fall back to origin. */
function pinsById(component: Component, anchors: Record<string, Point>): Record<string, Point> {
  const pins: Record<string, Point> = {};
  for (const pin of component.pins) {
    pins[pin.id] = anchors[pin.id] ?? { x: 0, y: 0 };
  }
  return pins;
}

const MCU_ROW_SPACING = 20;
const MCU_HALF_WIDTH = 60;

export function getSymbolGeometry(component: Component): SymbolGeometry {
  const kind = getSymbolKind(component);
  switch (kind) {
    case "resistor":
      return { halfWidth: 30, halfHeight: 10, pins: twoPinHorizontal(component, 30) };
    case "capacitor":
      return { halfWidth: 20, halfHeight: 12, pins: twoPinHorizontal(component, 20) };
    case "led":
    case "diode":
    case "zener":
    case "schottky":
      return { halfWidth: 20, halfHeight: 14, pins: twoPinHorizontal(component, 20) };
    case "inductor":
      return { halfWidth: 30, halfHeight: 10, pins: twoPinHorizontal(component, 30) };
    case "npn":
    case "pnp":
      return {
        halfWidth: 22,
        halfHeight: 24,
        pins: pinsById(component, {
          b: { x: -22, y: 0 },
          c: { x: 14, y: -24 },
          e: { x: 14, y: 24 },
        }),
      };
    case "nmos":
      return {
        halfWidth: 22,
        halfHeight: 24,
        pins: pinsById(component, {
          g: { x: -22, y: 0 },
          d: { x: 14, y: -24 },
          s: { x: 14, y: 24 },
        }),
      };
    case "opamp":
      return {
        halfWidth: 26,
        halfHeight: 22,
        pins: pinsById(component, {
          inp: { x: -26, y: 10 },
          inn: { x: -26, y: -10 },
          out: { x: 26, y: 0 },
        }),
      };
    case "potentiometer":
      return {
        halfWidth: 30,
        halfHeight: 22,
        pins: pinsById(component, {
          p1: { x: -30, y: 0 },
          p2: { x: 30, y: 0 },
          wiper: { x: 0, y: -22 },
        }),
      };
    case "pushbutton":
    case "switch":
      return { halfWidth: 22, halfHeight: 14, pins: twoPinHorizontal(component, 22) };
    case "motor":
    case "buzzer":
    case "lamp":
      return { halfWidth: 24, halfHeight: 14, pins: twoPinHorizontal(component, 24) };
    case "rgbled":
      return {
        halfWidth: 24,
        halfHeight: 28,
        pins: pinsById(component, {
          r: { x: -24, y: -20 },
          g: { x: -24, y: 0 },
          b: { x: -24, y: 20 },
          com: { x: 24, y: 0 },
        }),
      };
    case "ldr":
      return { halfWidth: 30, halfHeight: 16, pins: twoPinHorizontal(component, 30) };
    case "vsource":
    case "acsource":
    case "isource": {
      const pins: Record<string, Point> = {};
      const [pos, neg] = component.pins;
      if (pos) pins[pos.id] = { x: 0, y: -30 };
      if (neg) pins[neg.id] = { x: 0, y: 30 };
      return { halfWidth: 16, halfHeight: 30, pins };
    }
    case "ground": {
      const pins: Record<string, Point> = {};
      const [gnd] = component.pins;
      if (gnd) pins[gnd.id] = { x: 0, y: -12 };
      return { halfWidth: 14, halfHeight: 12, pins };
    }
    case "ic":
    case "mcu":
    case "generic": {
      const pins: Record<string, Point> = {};
      const perSide = Math.ceil(component.pins.length / 2);
      const columnHeight = (perSide - 1) * MCU_ROW_SPACING;
      component.pins.forEach((pin, index) => {
        const left = index < perSide;
        const row = left ? index : index - perSide;
        pins[pin.id] = {
          x: left ? -MCU_HALF_WIDTH : MCU_HALF_WIDTH,
          y: row * MCU_ROW_SPACING - columnHeight / 2,
        };
      });
      return {
        halfWidth: MCU_HALF_WIDTH,
        halfHeight: columnHeight / 2 + MCU_ROW_SPACING,
        pins,
      };
    }
  }
}

export function rotatePoint(point: Point, rotation: 0 | 90 | 180 | 270): Point {
  switch (rotation) {
    case 90:
      return { x: -point.y, y: point.x };
    case 180:
      return { x: -point.x, y: -point.y };
    case 270:
      return { x: point.y, y: -point.x };
    default:
      return point;
  }
}

export function getInstancePlacement(
  schematic: Schematic,
  instanceId: string,
): { x: number; y: number; rotation: 0 | 90 | 180 | 270 } {
  const entry = schematic.layout?.instances[instanceId];
  return { x: entry?.x ?? 0, y: entry?.y ?? 0, rotation: entry?.rotation ?? 0 };
}

/** Absolute world position of a pin, honoring layout translation + rotation. */
export function getPinPosition(
  schematic: Schematic,
  component: Component,
  instanceId: string,
  pinId: string,
): Point {
  const placement = getInstancePlacement(schematic, instanceId);
  const offset = getSymbolGeometry(component).pins[pinId] ?? { x: 0, y: 0 };
  const rotated = rotatePoint(offset, placement.rotation);
  return { x: placement.x + rotated.x, y: placement.y + rotated.y };
}

/** Orthogonal (H-then-V midpoint) polyline between two points. */
export function orthogonalPoints(a: Point, b: Point): Point[] {
  if (a.x === b.x || a.y === b.y) return [a, b];
  const midX = Math.round((a.x + b.x) / 2);
  return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
}

export function toPolylinePoints(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** World-space axis-aligned bounds of a placed component (center + half-extents). */
export interface ComponentBounds {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface View {
  zoom: number;
  pan: Point;
}

/** Fraction of the viewport left as breathing room around framed content. */
const FIT_MARGIN = 0.1;

/**
 * Compute a `{zoom, pan}` view that frames every component's bounds inside the
 * viewport with a small margin, zoom clamped to `[MIN_ZOOM, MAX_ZOOM]`. Screen
 * space is `screen = world * zoom + pan`, so the content bbox center is mapped
 * to the viewport center. An empty schematic (or a degenerate viewport) returns
 * the identity/default view — never NaN.
 */
export function fitToContent(components: ComponentBounds[], viewport: Viewport): View {
  const identity: View = { zoom: 1, pan: { x: 0, y: 0 } };
  if (
    components.length === 0 ||
    !(viewport.width > 0) ||
    !(viewport.height > 0)
  ) {
    return identity;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of components) {
    minX = Math.min(minX, c.x - c.halfWidth);
    minY = Math.min(minY, c.y - c.halfHeight);
    maxX = Math.max(maxX, c.x + c.halfWidth);
    maxY = Math.max(maxY, c.y + c.halfHeight);
  }

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const usableWidth = viewport.width * (1 - FIT_MARGIN);
  const usableHeight = viewport.height * (1 - FIT_MARGIN);

  // Guard the zero-extent case (all bounds collapsed to a point).
  const zoomX = contentWidth > 0 ? usableWidth / contentWidth : MAX_ZOOM;
  const zoomY = contentHeight > 0 ? usableHeight / contentHeight : MAX_ZOOM;
  const zoom = clampZoom(Math.min(zoomX, zoomY));

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const pan: Point = {
    x: viewport.width / 2 - centerX * zoom,
    y: viewport.height / 2 - centerY * zoom,
  };

  return { zoom, pan };
}

/**
 * Junction dots (issue #129): given ONE net's wire segments (each an orthogonal
 * polyline of >=2 points), return the coordinates that form a genuine multi-way
 * join. Only true endpoints (first + last point of a segment) count —
 * intermediate bend vertices never form a junction.
 *
 * Wires route as a STAR (netWireSegments): an N-pin net emits N-1 segments that
 * all share the anchor (first pin) as an endpoint. So the anchor's coincident-
 * endpoint count is N-1, i.e. a genuine 3-pin tee gives it degree 2. A dot is
 * therefore warranted wherever >= 2 segment endpoints coincide within the net
 * (the anchor pin is itself a connection, so degree-2 means three pins meet):
 *   - 2-pin net -> single segment, both endpoints appear once -> no dot.
 *   - >=3-pin net -> the anchor appears in every arm -> exactly one dot there.
 * A leaf pin appears once, so leaves never dot. Because the input is a single
 * net's segments, crossovers between different nets can never produce a junction
 * (nets are evaluated separately).
 */
export function computeJunctions(segments: Point[][]): Point[] {
  const counts = new Map<string, { point: Point; count: number }>();
  for (const segment of segments) {
    const first = segment[0];
    const last = segment[segment.length - 1];
    for (const endpoint of [first, last]) {
      if (!endpoint) continue;
      const key = `${endpoint.x},${endpoint.y}`;
      const entry = counts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(key, { point: { x: endpoint.x, y: endpoint.y }, count: 1 });
      }
    }
  }
  const junctions: Point[] = [];
  for (const { point, count } of counts.values()) {
    if (count >= 2) junctions.push(point);
  }
  return junctions;
}
