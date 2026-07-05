/**
 * SPICE netlist (.cir/.net) adapter contract (issue #41).
 *
 * Round-trip contract: import(export(doc)) deep-equals doc, modulo provenance,
 * which is regenerated on import — the test normalizes provenance before
 * comparing (parity with the KiCad adapter's round-trip test).
 */
import { describe, it, expect } from "vitest";
import { IR_VERSION, type Netlist } from "@openbench/ir-schema";
import { exportNetlist, importNetlist, validate } from "../src/spice-netlist";

const richNetlist: Netlist = {
  irVersion: IR_VERSION,
  kind: "netlist",
  id: "net_rc_divider",
  schematicId: "sch_rc_divider",
  nodes: [
    { netId: "net_vin", spiceNode: "1" },
    { netId: "net_vout", spiceNode: "2" },
    { netId: "net_gnd", spiceNode: "0" },
  ],
  elements: [
    { instanceId: "V1", spiceCard: "V1 1 0 DC 5" },
    { instanceId: "R1", spiceCard: "R1 1 2 1k" },
    { instanceId: "C1", spiceCard: "C1 2 0 1u" },
    { instanceId: "D1", spiceCard: "D1 2 0 DLED" },
    { instanceId: "cmp_led", spiceCard: ".model DLED D (IS=1e-14)" },
    { instanceId: "cmp_opamp", spiceCard: ".subckt OPAMP 1 2 3\nE1 3 0 1 2 1e6\n.ends" },
  ],
  derivedBy: "netlist-compiler@0.1.0",
  provenance: { source: "netlist-compiler", at: "2026-07-05T00:00:00Z" },
};

function normalizeProvenance(doc: Netlist): Netlist {
  return { ...doc, provenance: { ...doc.provenance, at: "<normalized>", source: "<normalized>" } };
}

describe("exportNetlist", () => {
  it("emits the element spiceCards in order", () => {
    const deck = exportNetlist(richNetlist);
    const body = richNetlist.elements.map((e) => e.spiceCard).join("\n");
    expect(deck).toContain(body);
  });

  it("includes .model / .subckt blocks and a terminating .end", () => {
    const deck = exportNetlist(richNetlist);
    expect(deck).toContain(".model DLED D (IS=1e-14)");
    expect(deck).toContain(".subckt OPAMP 1 2 3");
    expect(deck).toContain("\n.ends");
    expect(deck.trimEnd().endsWith(".end")).toBe(true);
  });

  it("throws a structured error on an invalid netlist IR", () => {
    const bad = { ...richNetlist, id: "not-a-net-id" } as unknown as Netlist;
    expect(() => exportNetlist(bad)).toThrow();
  });
});

describe("round-trip contract", () => {
  it("import(export(doc)) deep-equals doc modulo provenance", () => {
    const deck = exportNetlist(richNetlist);
    const result = importNetlist(deck);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(normalizeProvenance(result.netlist)).toEqual(normalizeProvenance(richNetlist));
  });

  it("regenerates provenance on import (source mcp-sim-spice, fresh timestamp)", () => {
    const result = importNetlist(exportNetlist(richNetlist));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.provenance.source).toBe("mcp-sim-spice");
    expect(() => new Date(result.netlist.provenance.at)).not.toThrow();
  });
});

describe("importNetlist — foreign deck", () => {
  const foreignDeck = [
    "An RC + transistor test deck",
    "V1 1 0 DC 5",
    "R1 1 2 1k",
    "C1 2 0 1u",
    "L1 2 3 10m",
    "D1 3 0 DLED",
    "Q1 4 2 0 QNPN",
    "M1 5 2 0 0 NMOS",
    ".model DLED D (IS=1e-14)",
    ".model QNPN NPN (BF=100)",
    ".subckt AMP 1 2",
    "R 1 2 1k",
    ".ends",
    ".tran 1u 1m",
    ".end",
  ].join("\n");

  it("parses R/C/L/V/D/Q/M cards into elements keyed by their ref", () => {
    const result = importNetlist(foreignDeck);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.netlist.elements.map((e) => e.instanceId);
    expect(ids).toEqual(expect.arrayContaining(["V1", "R1", "C1", "L1", "D1", "Q1", "M1"]));
    const r1 = result.netlist.elements.find((e) => e.instanceId === "R1");
    expect(r1?.spiceCard).toBe("R1 1 2 1k");
  });

  it("parses .model and .subckt blocks into elements", () => {
    const result = importNetlist(foreignDeck);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cards = result.netlist.elements.map((e) => e.spiceCard);
    expect(cards).toContain(".model DLED D (IS=1e-14)");
    expect(cards.some((c) => c.startsWith(".subckt AMP") && c.includes(".ends"))).toBe(true);
  });

  it("collects every referenced SPICE node (ground 0 included)", () => {
    const result = importNetlist(foreignDeck);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spiceNodes = result.netlist.nodes.map((n) => n.spiceNode).sort();
    expect(spiceNodes).toEqual(["0", "1", "2", "3", "4", "5"]);
  });
});

describe("importNetlist — escape hatch for unsupported cards", () => {
  it("preserves an unsupported element card and warns, never throwing", () => {
    const deck = ["title", "R1 1 0 1k", "W1 1 0 wackydevice", ".end"].join("\n");
    let result!: ReturnType<typeof importNetlist>;
    expect(() => {
      result = importNetlist(deck);
    }).not.toThrow();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const raw = result.netlist.elements.find((e) => e.instanceId.startsWith("x_openbench_raw"));
    expect(raw?.spiceCard).toBe("W1 1 0 wackydevice");
    expect(result.warnings.some((w) => w.includes("W1"))).toBe(true);
  });
});

describe("importNetlist — malformed deck", () => {
  it("returns structured errors (never throws) for a device card with no nodes", () => {
    let result!: ReturnType<typeof importNetlist>;
    expect(() => {
      result = importNetlist(["title", "R1", ".end"].join("\n"));
    }).not.toThrow();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty("message");
  });

  it("returns an error for a .subckt with no matching .ends", () => {
    const result = importNetlist(["title", ".subckt AMP 1 2", "R 1 2 1k", ".end"].join("\n"));
    expect(result.ok).toBe(false);
  });
});

describe("validate", () => {
  it("delegates to the canonical netlist IR schema", () => {
    expect(validate(richNetlist)).toEqual({ valid: true, errors: [] });
  });
});
