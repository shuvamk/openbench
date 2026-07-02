import { describe, expect, it } from "vitest";
import { IR_VERSION, validateSchematic, type Schematic } from "@openbench/ir-schema";
import type { ProjectBundle } from "../lib/project-store/types";
import { createFromTemplate } from "../lib/templates";
import { exportProjectToKicad, importKicadToBundle } from "../lib/kicad/io";

/** Hand-built bundle mixing a registry component with an unknown one. */
function mixedBundle(): ProjectBundle {
  const schematic: Schematic = {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_dropcase",
    projectId: "proj_dropcase",
    instances: [
      {
        instanceId: "R1",
        componentId: "cmp_resistor_generic",
        parameterOverrides: { resistance: 2200 },
      },
      { instanceId: "X1", componentId: "cmp_mystery_part" },
    ],
    nets: [
      {
        netId: "net_a",
        name: "A",
        connections: [
          { instanceId: "R1", pinId: "p1" },
          { instanceId: "X1", pinId: "p1" },
        ],
      },
      {
        netId: "net_b",
        name: "B",
        connections: [{ instanceId: "X1", pinId: "p2" }],
      },
    ],
    layout: {
      instances: {
        R1: { x: 10, y: 20 },
        X1: { x: 30, y: 40, rotation: 90 },
      },
    },
    provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
  };
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: "proj_dropcase",
      name: "Drop case",
      schematicId: "sch_dropcase",
      collaborators: [],
      provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
    },
    schematic,
  };
}

describe("exportProjectToKicad", () => {
  it("produces a kicad_sch document with a slugged filename", () => {
    const bundle = createFromTemplate("rc-lowpass", "RC low-pass");
    const { filename, text } = exportProjectToKicad(bundle);
    expect(filename).toBe("rc-low-pass.kicad_sch");
    expect(text.trimStart().startsWith("(kicad_sch")).toBe(true);
    expect(text).toContain("x_openbench_schematic");
    expect(text).toContain("x_openbench_nets");
  });

  it("falls back to project.kicad_sch for unsluggable names", () => {
    const bundle = createFromTemplate("blank", "***");
    expect(exportProjectToKicad(bundle).filename).toBe("project.kicad_sch");
  });
});

describe("importKicadToBundle — rc-lowpass round-trip", () => {
  it("preserves instances, overrides, nets, and layout exactly", () => {
    const original = createFromTemplate("rc-lowpass", "RC low-pass");
    const { text } = exportProjectToKicad(original);
    const result = importKicadToBundle(text, "RC re-import");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bundle.schematic.instances).toEqual(original.schematic.instances);
    expect(result.bundle.schematic.nets).toEqual(original.schematic.nets);
    expect(result.bundle.schematic.layout).toEqual(original.schematic.layout);
    expect(result.warnings).toEqual([]);
  });

  it("builds a fresh project doc with kicad-import provenance", () => {
    const original = createFromTemplate("rc-lowpass", "RC low-pass");
    const { text } = exportProjectToKicad(original);
    const result = importKicadToBundle(text, "RC re-import");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { project, schematic } = result.bundle;
    expect(project.kind).toBe("project");
    expect(project.name).toBe("RC re-import");
    // fresh proj_ id from crypto.randomUUID().replace(/-/g, "")
    expect(project.id).toMatch(/^proj_[0-9a-f]{32}$/);
    expect(project.id).not.toBe(original.project.id);
    expect(project.provenance.source).toBe("kicad-import");
    expect(project.schematicId).toBe(schematic.id);
    expect(schematic.projectId).toBe(project.id);
    expect(validateSchematic(schematic).valid).toBe(true);
  });

  it("mints distinct project ids on repeated imports of the same file", () => {
    const { text } = exportProjectToKicad(createFromTemplate("rc-lowpass", "RC"));
    const first = importKicadToBundle(text, "one");
    const second = importKicadToBundle(text, "two");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.bundle.project.id).not.toBe(second.bundle.project.id);
  });
});

describe("importKicadToBundle — foreign KiCad files", () => {
  const foreign = `(kicad_sch (version 20231120) (generator "eeschema")
    (uuid "9e1c4f6a-0000-4000-8000-abcdefabcdef")
    (paper "A4")
    (symbol (lib_id "Device:R") (at 100 50 0) (unit 1)
      (property "Reference" "R1" (at 100 50 0))
      (property "Value" "10k" (at 100 50 0)))
    (symbol (lib_id "resistor_generic") (at 200 75 0) (unit 1)
      (property "Reference" "R2" (at 200 75 0))
      (property "Value" "4k7" (at 200 75 0)))
    (global_label "VCC" (shape input) (at 100 50 0))
    (global_label "GND" (shape input) (at 200 75 0))
  )`;

  it("imports with warnings, dropping instances that miss the registry", () => {
    const result = importKicadToBundle(foreign, "Imported foreign");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { bundle, warnings } = result;
    // Device:R sanitizes to cmp_device_r — not a registry component — dropped.
    expect(bundle.schematic.instances.map((i) => i.instanceId)).toEqual(["R2"]);
    expect(bundle.schematic.instances[0]!.componentId).toBe("cmp_resistor_generic");
    expect(warnings).toContain("skipped R1: unknown component cmp_device_r");
    // adapter heuristics warnings (derived componentIds, empty connectivity) surface too
    expect(warnings.some((w) => /connectivity|connections/i.test(w))).toBe(true);

    // nets survive by name; connectivity is unknowable for foreign files
    expect(bundle.schematic.nets).toEqual([
      { netId: "net_vcc", name: "VCC", connections: [] },
      { netId: "net_gnd", name: "GND", connections: [] },
    ]);
    // layout entries for dropped instances are removed
    expect(bundle.schematic.layout?.instances).toEqual({ R2: { x: 200, y: 75 } });

    expect(bundle.project.name).toBe("Imported foreign");
    expect(bundle.project.provenance.source).toBe("kicad-import");
    expect(validateSchematic(bundle.schematic).valid).toBe(true);
  });

  it("returns structured errors for input that is not a kicad_sch document", () => {
    const result = importKicadToBundle("hello world", "nope");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) {
      expect(typeof error.path).toBe("string");
      expect(typeof error.message).toBe("string");
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

describe("importKicadToBundle — unknown-component drop rules (openbench metadata)", () => {
  it("keeps registry-resolvable instances, drops the rest plus their connections", () => {
    const { text } = exportProjectToKicad(mixedBundle());
    const result = importKicadToBundle(text, "Mixed import");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { bundle, warnings } = result;
    // X1 carries x_openbench metadata but cmp_mystery_part is not in the registry
    expect(warnings).toContain("skipped X1: unknown component cmp_mystery_part");
    expect(bundle.schematic.instances).toEqual([
      {
        instanceId: "R1",
        componentId: "cmp_resistor_generic",
        parameterOverrides: { resistance: 2200 },
      },
    ]);
    // X1's connections are dropped; nets themselves survive
    expect(bundle.schematic.nets).toEqual([
      { netId: "net_a", name: "A", connections: [{ instanceId: "R1", pinId: "p1" }] },
      { netId: "net_b", name: "B", connections: [] },
    ]);
    // and so is its layout entry
    expect(bundle.schematic.layout?.instances).toEqual({ R1: { x: 10, y: 20 } });
    expect(validateSchematic(bundle.schematic).valid).toBe(true);
  });
});
