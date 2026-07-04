import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { checkSchematic, type Violation } from "../src/check";

/**
 * Acceptance tests for issue #35 — the electrical-rule-check engine. ERC is a
 * pure function over the schematic IR (component resolution injected), so every
 * fixture is a full Schematic IR document. Rules key off `pin.electricalType`.
 */

const AT = "2026-07-04T00:00:00Z";

function sch(
  instances: Schematic["instances"],
  nets: Schematic["nets"],
): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_erc",
    projectId: "proj_erc",
    instances,
    nets,
    provenance: { source: "test", at: AT },
  };
}

/** A fully-wired source→R→C→ground low-pass — the canonical clean circuit. */
function rcClean(): Schematic {
  return sch(
    [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "R1", componentId: "cmp_resistor_generic" },
      { instanceId: "C1", componentId: "cmp_capacitor_generic" },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    [
      {
        netId: "net_in",
        name: "IN",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_out",
        name: "OUT",
        connections: [
          { instanceId: "R1", pinId: "p2" },
          { instanceId: "C1", pinId: "p1" },
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
  );
}

const rules = (violations: Violation[]): string[] => violations.map((v) => v.rule);
const byRule = (violations: Violation[], rule: string): Violation | undefined =>
  violations.find((v) => v.rule === rule);

describe("checkSchematic", () => {
  it("a clean, fully-wired RC + ground schematic has no violations", () => {
    const { violations } = checkSchematic(rcClean(), getComponent);
    expect(violations).toEqual([]);
  });

  it("ERC_NO_GROUND: sources but no ground yields exactly one error", () => {
    const noGround = sch(
      [
        { instanceId: "V1", componentId: "cmp_vsource_dc" },
        { instanceId: "R1", componentId: "cmp_resistor_generic" },
      ],
      [
        {
          netId: "net_a",
          connections: [
            { instanceId: "V1", pinId: "pos" },
            { instanceId: "R1", pinId: "p1" },
          ],
        },
        {
          netId: "net_b",
          name: "N2",
          connections: [
            { instanceId: "V1", pinId: "neg" },
            { instanceId: "R1", pinId: "p2" },
          ],
        },
      ],
    );
    const { violations } = checkSchematic(noGround, getComponent);
    const noGroundViolations = violations.filter((v) => v.rule === "ERC_NO_GROUND");
    expect(noGroundViolations).toHaveLength(1);
    expect(noGroundViolations[0]!.severity).toBe("error");
  });

  it("ERC_FLOATING_PIN: a pin on no net is a warning naming the instance and pin", () => {
    const base = rcClean();
    base.instances.push({ instanceId: "R2", componentId: "cmp_resistor_generic" });
    // R2.p1 joins an existing net; R2.p2 is left on no net → floating.
    base.nets[1]!.connections.push({ instanceId: "R2", pinId: "p1" });
    const { violations } = checkSchematic(base, getComponent);
    const floating = byRule(violations, "ERC_FLOATING_PIN");
    expect(floating).toBeDefined();
    expect(floating!.severity).toBe("warning");
    expect(floating!.instanceIds).toContain("R2");
    expect(floating!.message).toContain("p2");
  });

  it("ERC_POWER_NOT_DRIVEN: a power_in pin with no driver on its net is an error", () => {
    const s = sch(
      [
        { instanceId: "U1", componentId: "cmp_esp32_devkit" },
        { instanceId: "R1", componentId: "cmp_resistor_generic" },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      [
        {
          // VIN is power_in; R1.p1 is passive → nothing drives this net.
          netId: "net_pwr",
          connections: [
            { instanceId: "U1", pinId: "VIN" },
            { instanceId: "R1", pinId: "p1" },
          ],
        },
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "R1", pinId: "p2" },
            { instanceId: "GND1", pinId: "gnd" },
          ],
        },
      ],
    );
    const { violations } = checkSchematic(s, getComponent);
    const undriven = byRule(violations, "ERC_POWER_NOT_DRIVEN");
    expect(undriven).toBeDefined();
    expect(undriven!.severity).toBe("error");
    expect(undriven!.instanceIds).toContain("U1");
    expect(undriven!.netIds).toContain("net_pwr");
  });

  it("ERC_OUTPUT_CONFLICT: two output pins on one net is an error listing both", () => {
    const s = sch(
      [
        { instanceId: "U1", componentId: "cmp_esp32_devkit" },
        { instanceId: "U2", componentId: "cmp_esp32_devkit" },
      ],
      [
        {
          // TX0 is an output on both MCUs → contention.
          netId: "net_bus",
          connections: [
            { instanceId: "U1", pinId: "TX0" },
            { instanceId: "U2", pinId: "TX0" },
          ],
        },
      ],
    );
    const { violations } = checkSchematic(s, getComponent);
    const conflict = byRule(violations, "ERC_OUTPUT_CONFLICT");
    expect(conflict).toBeDefined();
    expect(conflict!.severity).toBe("error");
    expect(conflict!.instanceIds).toEqual(expect.arrayContaining(["U1", "U2"]));
    expect(conflict!.netIds).toContain("net_bus");
  });

  it("ERC_SINGLE_PIN_NET: a net with fewer than two pins is a warning", () => {
    const base = rcClean();
    base.instances.push({ instanceId: "R2", componentId: "cmp_resistor_generic" });
    base.nets.push({
      netId: "net_stub",
      connections: [{ instanceId: "R2", pinId: "p1" }],
    });
    const { violations } = checkSchematic(base, getComponent);
    const stub = byRule(violations, "ERC_SINGLE_PIN_NET");
    expect(stub).toBeDefined();
    expect(stub!.severity).toBe("warning");
    expect(stub!.netIds).toContain("net_stub");
  });

  it("never throws on malformed input — an unresolved component becomes a violation", () => {
    const s = sch(
      [{ instanceId: "X1", componentId: "cmp_does_not_exist" }],
      [{ netId: "net_x", connections: [{ instanceId: "X1", pinId: "p1" }] }],
    );
    let result!: ReturnType<typeof checkSchematic>;
    expect(() => {
      result = checkSchematic(s, getComponent);
    }).not.toThrow();
    const unresolved = byRule(result.violations, "ERC_UNRESOLVED_COMPONENT");
    expect(unresolved).toBeDefined();
    expect(unresolved!.severity).toBe("error");
    expect(unresolved!.instanceIds).toContain("X1");
  });

  it("tolerates an empty schematic without throwing", () => {
    const empty = sch([], []);
    expect(() => checkSchematic(empty, getComponent)).not.toThrow();
    expect(checkSchematic(empty, getComponent).violations).toEqual([]);
  });

  it("every violation carries a stable rule code and human message", () => {
    const base = rcClean();
    base.instances.push({ instanceId: "R2", componentId: "cmp_resistor_generic" });
    const { violations } = checkSchematic(base, getComponent);
    for (const v of violations) {
      expect(v.rule).toMatch(/^ERC_[A-Z_]+$/);
      expect(v.message.length).toBeGreaterThan(0);
      expect(["error", "warning"]).toContain(v.severity);
    }
  });
});
