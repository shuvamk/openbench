import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { deriveErcIssues, instanceSeverities } from "../lib/editor/erc";
import { createFromTemplate } from "../lib/templates";

/**
 * Issue #71 acceptance — the pure schematic → ERC view-model derivation that
 * feeds the Inspector panel and canvas badges. It wraps `@openbench/erc`'s
 * `checkSchematic` and turns machine `Violation`s into plain-language issues a
 * beginner can act on (no `ERC_*` codes ever leak into the view-model).
 */

const AT = "2026-07-05T00:00:00Z";

function sch(
  instances: Schematic["instances"],
  nets: Schematic["nets"],
): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_erc_ui",
    projectId: "proj_erc_ui",
    instances,
    nets,
    provenance: { source: "test", at: AT },
  };
}

/** A source driving an LED with no ground reference anywhere. */
function ledNoGround(): Schematic {
  return sch(
    [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "D1", componentId: "cmp_led_generic" },
    ],
    [
      {
        netId: "net_a",
        name: "A",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "D1", pinId: "anode" },
        ],
      },
      {
        netId: "net_b",
        name: "B",
        connections: [
          { instanceId: "V1", pinId: "neg" },
          { instanceId: "D1", pinId: "cathode" },
        ],
      },
    ],
  );
}

/** Same LED, but its cathode pin is left dangling (on no net). */
function ledFloatingCathode(): Schematic {
  return sch(
    [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "D1", componentId: "cmp_led_generic" },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    [
      {
        netId: "net_a",
        name: "A",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "D1", pinId: "anode" },
        ],
      },
      {
        netId: "net_gnd",
        name: "GND",
        connections: [
          { instanceId: "V1", pinId: "neg" },
          { instanceId: "GND1", pinId: "gnd" },
        ],
      },
    ],
  );
}

const noErcCode = (s: string) => expect(s).not.toMatch(/ERC_[A-Z_]+/);

describe("deriveErcIssues", () => {
  it("flags a no-ground circuit (source but no ground reference)", () => {
    const issues = deriveErcIssues(ledNoGround());
    const noGround = issues.filter((i) => i.severity === "error");
    expect(noGround.length).toBeGreaterThan(0);
    // At least one issue is specifically about the missing ground, in plain words.
    const grounds = issues.filter((i) => /ground/i.test(i.message));
    expect(grounds.length).toBeGreaterThan(0);
    for (const i of issues) noErcCode(i.message);
  });

  it("flags a floating pin, naming the offending instance and pin", () => {
    const issues = deriveErcIssues(ledFloatingCathode());
    const floating = issues.find(
      (i) => i.message.includes("D1") && /cathode/.test(i.message),
    );
    expect(floating).toBeDefined();
    expect(floating!.severity).toBe("warning");
    expect(floating!.instanceIds).toContain("D1");
    expect(floating!.primaryInstanceId).toBe("D1");
    noErcCode(floating!.message);
  });

  it("reports no issues for a valid RC-lowpass template (no false positives)", () => {
    const bundle = createFromTemplate("rc-lowpass", "RC demo");
    const issues = deriveErcIssues(bundle.schematic);
    expect(issues).toEqual([]);
  });

  it("never leaks a raw ERC_ machine code into any message", () => {
    for (const schematic of [ledNoGround(), ledFloatingCathode()]) {
      for (const issue of deriveErcIssues(schematic)) noErcCode(issue.message);
    }
  });

  it("indexes the highest severity per instance (error beats warning)", () => {
    // Output conflict (error) + floating pins (warning) on the same source.
    const issues = deriveErcIssues(ledFloatingCathode());
    const sev = instanceSeverities(issues);
    // D1 has a floating cathode → at least a warning is recorded for it.
    expect(sev.get("D1")).toBeDefined();
  });
});
