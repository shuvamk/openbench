import { describe, expect, it } from "vitest";
import type { Schematic } from "@openbench/ir-schema";
import { exportSchematic, importSchematic, validate } from "../src/index";
import { parse } from "../src/sexpr";

/**
 * Acceptance tests for issue #8 — the KiCad adapter (Phase 1: flat single
 * sheet). Round-trip contract per .context/interchange-format.md §adapter
 * contract: import(export(doc)) deep-equals doc, modulo provenance, which is
 * REGENERATED on import (source: "mcp-kicad", at: import time) — the contract
 * test therefore normalizes `provenance.at` before comparing.
 */

/** Two-instance schematic WITH layout and parameter overrides. */
const richSchematic: Schematic = {
  irVersion: "0.1.0",
  kind: "schematic",
  id: "sch_00000000-0000-4000-8000-000000000001",
  projectId: "proj_00000000-0000-4000-8000-000000000002",
  instances: [
    {
      instanceId: "R1",
      componentId: "cmp_resistor_generic",
      parameterOverrides: { resistance: 4700 },
    },
    { instanceId: "U1", componentId: "cmp_esp32_devkit" },
  ],
  nets: [
    {
      netId: "net_vcc",
      name: "VCC",
      connections: [
        { instanceId: "R1", pinId: "p1" },
        { instanceId: "U1", pinId: "3V3" },
      ],
    },
    {
      netId: "net_gnd",
      name: "GND",
      connections: [
        { instanceId: "R1", pinId: "p2" },
        { instanceId: "U1", pinId: "GND" },
      ],
    },
  ],
  layout: {
    instances: {
      R1: { x: 120, y: 80, rotation: 90 },
      U1: { x: 320, y: 160 },
    },
  },
  provenance: { source: "mcp-kicad", at: "2026-07-02T00:00:00Z" },
};

const NOW = "2026-07-02T12:00:00.000Z";

function normalizeProvenanceAt(doc: Schematic): Schematic {
  return { ...doc, provenance: { ...doc.provenance, at: "<normalized>" } };
}

describe("round-trip contract", () => {
  it("import(export(doc)) deep-equals doc for a two-instance schematic with layout and overrides", () => {
    const exported = exportSchematic(richSchematic, { now: NOW });
    const result = importSchematic(exported);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(normalizeProvenanceAt(result.schematic)).toEqual(
      normalizeProvenanceAt(richSchematic),
    );
  });

  it("regenerates provenance on import (source mcp-kicad, fresh timestamp)", () => {
    const result = importSchematic(exportSchematic(richSchematic, { now: NOW }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schematic.provenance.source).toBe("mcp-kicad");
    expect(() => new Date(result.schematic.provenance.at)).not.toThrow();
  });

  it("round-trips a schematic WITHOUT layout (no layout key materializes)", () => {
    const { layout: _layout, ...rest } = richSchematic;
    const doc = structuredClone(rest) as Schematic;
    const result = importSchematic(exportSchematic(doc, { now: NOW }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schematic.layout).toBeUndefined();
    expect(normalizeProvenanceAt(result.schematic)).toEqual(normalizeProvenanceAt(doc));
  });

  it("preserves absence vs presence of parameterOverrides exactly", () => {
    const doc = structuredClone(richSchematic);
    doc.instances[1]!.parameterOverrides = {};
    const result = importSchematic(exportSchematic(doc, { now: NOW }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schematic.instances[0]!.parameterOverrides).toEqual({ resistance: 4700 });
    expect(result.schematic.instances[1]!.parameterOverrides).toEqual({});
    const bare = importSchematic(exportSchematic(richSchematic, { now: NOW }));
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect("parameterOverrides" in bare.schematic.instances[1]!).toBe(false);
  });
});

describe("exportSchematic", () => {
  it("emits a parseable kicad_sch document", () => {
    const text = exportSchematic(richSchematic, { now: NOW });
    const tree = parse(text);
    expect(Array.isArray(tree)).toBe(true);
    expect(text.trimStart().startsWith("(kicad_sch")).toBe(true);
  });

  it("maps instances to (symbol …) with Reference/Value/x_openbench_component properties", () => {
    const text = exportSchematic(richSchematic, { now: NOW });
    expect(text).toContain('(property "Reference" "R1"');
    expect(text).toContain('(property "Reference" "U1"');
    // Value = primary parameter value when overrides exist …
    expect(text).toContain('(property "Value" "4700"');
    // … or the component name (componentId sans cmp_ prefix) when they don't.
    expect(text).toContain('(property "Value" "esp32_devkit"');
    expect(text).toContain('(property "x_openbench_component" "cmp_resistor_generic"');
    expect(text).toContain('(property "x_openbench_component" "cmp_esp32_devkit"');
  });

  it("positions symbols from schematic.layout, defaulting to 0,0", () => {
    const text = exportSchematic(richSchematic, { now: NOW });
    expect(text).toContain("(at 120 80 90)");
    expect(text).toContain("(at 320 160 0)");
    const { layout: _layout, ...rest } = richSchematic;
    const noLayout = exportSchematic(rest as Schematic, { now: NOW });
    expect(noLayout).toContain("(at 0 0 0)");
  });

  it("emits one global_label per net connection, named after the net", () => {
    const text = exportSchematic(richSchematic, { now: NOW });
    expect(text.match(/\(global_label "VCC"/g)).toHaveLength(2);
    expect(text.match(/\(global_label "GND"/g)).toHaveLength(2);
  });

  it("stores the full net list in an x_openbench_nets escape hatch", () => {
    const text = exportSchematic(richSchematic, { now: NOW });
    const tree = parse(text) as unknown[];
    const netsNode = (tree as unknown[][]).find(
      (node) => Array.isArray(node) && (node[0] as { sym?: string })?.sym === "x_openbench_nets",
    ) as unknown[] | undefined;
    expect(netsNode).toBeDefined();
    expect(JSON.parse(netsNode![1] as string)).toEqual(richSchematic.nets);
  });

  it("is deterministic for a fixed `now`", () => {
    expect(exportSchematic(richSchematic, { now: NOW })).toBe(
      exportSchematic(richSchematic, { now: NOW }),
    );
  });

  it("throws a descriptive error for an invalid schematic", () => {
    expect(() => exportSchematic({ kind: "schematic" } as unknown as Schematic)).toThrow(
      /invalid schematic/i,
    );
  });
});

describe("importSchematic — malformed input", () => {
  const malformed = [
    ["unbalanced parens", "(kicad_sch (symbol"],
    ["truncated file", '(kicad_sch (version 20231120) (property "unterminated'],
    ["stray closing paren", "(kicad_sch))"],
    ["empty input", ""],
    ["not an s-expression", "hello world"],
  ] as const;

  it.each(malformed)("returns ok:false structured errors for %s (never throws)", (_name, input) => {
    const result = importSchematic(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) {
      expect(typeof error.path).toBe("string");
      expect(typeof error.message).toBe("string");
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("returns ok:false for a well-formed s-expression that is not kicad_sch", () => {
    const result = importSchematic('(kicad_pcb (version 20231120))');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toMatch(/kicad_sch/);
  });
});

describe("importSchematic — foreign KiCad files (no x_openbench metadata)", () => {
  const foreign = `(kicad_sch (version 20231120) (generator "eeschema")
    (uuid "9e1c4f6a-0000-4000-8000-abcdefabcdef")
    (paper "A4")
    (symbol (lib_id "Device:R") (at 100 50 90) (unit 1)
      (property "Reference" "R1" (at 100 50 0))
      (property "Value" "10k" (at 100 50 0)))
    (symbol (lib_id "MCU_Espressif:ESP32-WROOM-32") (at 200 75 0) (unit 1)
      (property "Reference" "U1" (at 200 75 0))
      (property "Value" "ESP32-WROOM-32" (at 200 75 0)))
    (symbol (lib_id "Device:C") (at 10 10 0) (unit 1)
      (property "Value" "no reference here" (at 10 10 0)))
    (global_label "VCC" (shape input) (at 100 50 0))
    (global_label "VCC" (shape input) (at 200 75 0))
    (global_label "GND" (shape input) (at 100 50 0))
  )`;

  it("reconstructs instances from symbols and nets from global_label names, with warnings", () => {
    const result = importSchematic(foreign);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { schematic, warnings } = result;

    expect(schematic.id).toBe("sch_9e1c4f6a-0000-4000-8000-abcdefabcdef");
    expect(schematic.instances.map((i) => i.instanceId)).toEqual(["R1", "U1"]);
    expect(schematic.instances[0]!.componentId).toBe("cmp_device_r");
    expect(schematic.instances[1]!.componentId).toBe("cmp_mcu_espressif_esp32_wroom_32");

    // one net per distinct label name; pin-level connectivity is unknowable
    expect(schematic.nets).toEqual([
      { netId: "net_vcc", name: "VCC", connections: [] },
      { netId: "net_gnd", name: "GND", connections: [] },
    ]);

    // layout reconstructed from symbol (at …) positions
    expect(schematic.layout?.instances).toEqual({
      R1: { x: 100, y: 50, rotation: 90 },
      U1: { x: 200, y: 75 },
    });

    // everything skipped or guessed is surfaced as a warning
    expect(warnings.some((w) => w.includes("Reference"))).toBe(true);
    expect(warnings.some((w) => /connectivity|connections/i.test(w))).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);

    // and the result is still a valid IR schematic
    expect(validate(schematic).valid).toBe(true);
  });

  it("generates ids and warns when the file has no uuid", () => {
    const result = importSchematic('(kicad_sch (version 20231120) (symbol (property "Reference" "R1") (at 0 0 0) (lib_id "Device:R")))');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schematic.id).toMatch(/^sch_[a-z0-9_-]+$/);
    expect(result.schematic.projectId).toMatch(/^proj_[a-z0-9_-]+$/);
  });
});

describe("validate", () => {
  it("delegates to validateSchematic from @openbench/ir-schema", () => {
    expect(validate(richSchematic)).toEqual({ valid: true, errors: [] });
    const bad = validate({ kind: "schematic" });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    for (const error of bad.errors) {
      expect(typeof error.path).toBe("string");
      expect(typeof error.message).toBe("string");
    }
  });
});
