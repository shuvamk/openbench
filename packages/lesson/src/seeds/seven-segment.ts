import { IR_VERSION, type ProjectBundle, type Schematic } from "@openbench/ir-schema";
import type { Lesson, SchematicPredicate, Step } from "../types";

/**
 * Seed lesson: **"7-Segment LED Display"** (issue #54) — the concrete college
 * practical that motivated teaching mode, authored directly against the lesson
 * framework (types from #89, validated by #50, playable via #153).
 *
 * The finished circuit lights every segment a–g of a common-cathode display
 * (the digit "8", the classic all-segments-on bench test) from a single 5 V DC
 * rail. Each anode segment is driven through its own 330 Ω current-limiting
 * resistor; the shared cathode — and the unused decimal point — tie to ground,
 * completing the loop back to the supply. This is the smallest design that
 * exercises the real `cmp_7segment_display` registry part (#44) end to end and
 * simulates with real forward-biased segment current (see the golden test).
 *
 * Every part carries a `role` so the "do it for me" auto-placer (#153) can
 * reconstruct the exact target from an empty canvas, one step at a time.
 */

const AT = "2026-07-06T00:00:00Z";
const PROVENANCE = { source: "seed:seven-segment", at: AT } as const;

/** The seven driven segments, in reading order; each gets a resistor R1..R7. */
const SEGMENTS = ["a", "b", "c", "d", "e", "f", "g"] as const;

/** Role names the predicates (and the auto-placer) bind to target instances. */
const DISPLAY_ROLE = "DISP";
const SUPPLY_ROLE = "V";
const GROUND_ROLE = "GND";
const resistorRole = (seg: string): string => `R_${seg.toUpperCase()}`;

const RESISTANCE_OHMS = 330;
const SUPPLY_VOLTS = 5;

// ── Target reference circuit ────────────────────────────────────────────────

const targetSchematic: Schematic = {
  irVersion: IR_VERSION,
  kind: "schematic",
  id: "sch_seven_segment",
  projectId: "proj_seven_segment",
  instances: [
    { instanceId: "V1", componentId: "cmp_vsource_dc", parameterOverrides: { voltage: SUPPLY_VOLTS } },
    { instanceId: "DISP1", componentId: "cmp_7segment_display" },
    { instanceId: "GND1", componentId: "cmp_ground" },
    ...SEGMENTS.map((_seg, i) => ({
      instanceId: `R${i + 1}`,
      componentId: "cmp_resistor_generic",
      parameterOverrides: { resistance: RESISTANCE_OHMS },
    })),
  ],
  nets: [
    {
      netId: "net_vcc",
      name: "VCC",
      connections: [
        { instanceId: "V1", pinId: "pos" },
        ...SEGMENTS.map((_seg, i) => ({ instanceId: `R${i + 1}`, pinId: "p1" })),
      ],
    },
    {
      netId: "net_gnd",
      name: "GND",
      connections: [
        { instanceId: "V1", pinId: "neg" },
        { instanceId: "DISP1", pinId: "com" },
        // The decimal point is unused; tying its anode to the cathode rail keeps
        // it dark (0 V across the diode) and leaves no pin floating.
        { instanceId: "DISP1", pinId: "dp" },
        { instanceId: "GND1", pinId: "gnd" },
      ],
    },
    ...SEGMENTS.map((seg, i) => ({
      netId: `net_seg_${seg}`,
      connections: [
        { instanceId: `R${i + 1}`, pinId: "p2" },
        { instanceId: "DISP1", pinId: seg },
      ],
    })),
  ],
  layout: {
    instances: {
      V1: { x: -160, y: 40 },
      GND1: { x: -160, y: 200 },
      DISP1: { x: 240, y: 100 },
      ...Object.fromEntries(
        SEGMENTS.map((_seg, i) => [`R${i + 1}`, { x: 40, y: -40 + i * 40 }]),
      ),
    },
  },
  provenance: PROVENANCE,
};

const targetBundle: ProjectBundle = {
  project: {
    irVersion: IR_VERSION,
    kind: "project",
    id: "proj_seven_segment",
    name: "7-Segment LED Display",
    schematicId: "sch_seven_segment",
    collaborators: [],
    provenance: PROVENANCE,
  },
  schematic: targetSchematic,
};

// ── Steps ───────────────────────────────────────────────────────────────────

/** Bind a segment's resistor p1 to the +5 V rail. */
const powerRail = (seg: string): SchematicPredicate => ({
  connected: {
    pins: [
      { role: resistorRole(seg), pin: "p1" },
      { role: SUPPLY_ROLE, pin: "pos" },
      { net: "VCC" },
    ],
  },
});

/** Bind a segment's resistor p2 to the matching display segment pin. */
const wireSegment = (seg: string): SchematicPredicate => ({
  connected: {
    pins: [
      { role: resistorRole(seg), pin: "p2" },
      { role: DISPLAY_ROLE, pin: seg },
    ],
  },
});

const steps: Step[] = [
  {
    id: "place-display",
    instruction:
      "Drag a **7-Segment Display** onto the canvas. It's a common-cathode digit: seven LED segments (a–g) plus a decimal point, all sharing one COM cathode pin.",
    expect: { component: { of: "cmp_7segment_display", as: DISPLAY_ROLE } },
    hint: "Find the 7-Segment Display in the parts palette and drop it on the sheet.",
    allowAutoPlace: true,
  },
  {
    id: "add-supply-and-ground",
    instruction:
      "Add a **5 V DC source** to power the digit and a **Ground** symbol for the return path.",
    expect: {
      all: [
        {
          component: {
            of: "cmp_vsource_dc",
            as: SUPPLY_ROLE,
            where: [{ param: "voltage", approx: { value: SUPPLY_VOLTS, tolerancePct: 10 } }],
          },
        },
        { component: { of: "cmp_ground", as: GROUND_ROLE } },
      ],
    },
    hint: "Place a DC Voltage Source and set it to about 5 V, then place a Ground symbol.",
    allowAutoPlace: true,
  },
  {
    id: "tie-cathode-to-ground",
    instruction:
      "Wire the display's **COM** cathode — and the unused decimal point — to **ground**, and connect the source's **−** terminal to the same ground rail. This closes the loop so segment current has a path back to the supply.",
    expect: {
      connected: {
        pins: [
          { role: DISPLAY_ROLE, pin: "com" },
          { role: DISPLAY_ROLE, pin: "dp" },
          { role: GROUND_ROLE, pin: "gnd" },
          { role: SUPPLY_ROLE, pin: "neg" },
          { net: "GND" },
        ],
      },
    },
    hint: "Draw wires from COM, dp, and the source's − pin to the Ground symbol.",
    allowAutoPlace: true,
  },
  {
    id: "add-current-limiting-resistors",
    instruction:
      "Add **seven 330 Ω resistors**, one per segment. Each limits the current through its segment so the LED isn't destroyed — the whole point of the practical.",
    expect: {
      all: SEGMENTS.map((seg) => ({
        component: {
          of: "cmp_resistor_generic",
          as: resistorRole(seg),
          where: [{ param: "resistance", approx: { value: RESISTANCE_OHMS, tolerancePct: 5 } }],
        },
      })),
    },
    hint: "Drop seven resistors and set each to 330 Ω.",
    allowAutoPlace: true,
  },
  {
    id: "power-the-resistors",
    instruction:
      "Connect **one end of every resistor to the +5 V rail** (the source's + terminal). This is the shared supply that feeds all the segments.",
    expect: { all: SEGMENTS.map(powerRail) },
    hint: "Wire each resistor's first pin to the source's + terminal.",
    allowAutoPlace: true,
  },
  {
    id: "wire-each-segment",
    instruction:
      "Wire the **other end of each resistor to its segment** (a–g). With the cathode grounded and the anodes fed through the resistors, every segment lights — the digit reads **8**.",
    expect: { all: SEGMENTS.map(wireSegment) },
    hint: "Connect resistor 1 → segment a, resistor 2 → segment b, and so on through g.",
    allowAutoPlace: true,
  },
];

/** The seeded "7-Segment LED Display" demo lesson (issue #54). */
export const sevenSegmentLesson: Lesson = {
  lessonFormat: "0.1.0",
  id: "les_seven_segment_display",
  title: "7-Segment LED Display",
  description:
    "Build the classic college bench practical: drive every segment of a common-cathode 7-segment display from a 5 V rail through current-limiting resistors, and read the digit **8**.",
  difficulty: "beginner",
  targetBundle,
  steps,
};
