import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic, type SimulationRun } from "@openbench/ir-schema";
import { explainCircuit } from "../lib/copilot/explain";

/**
 * Issue #43 acceptance — the read-only "explain this circuit" action. Given a
 * schematic with an ERC error and a failed simulation, it returns a summary
 * that cites the ERC rule id (consuming `@openbench/erc` + the latest
 * simulationRun) and is fully deterministic in mock mode.
 */

const AT = "2026-07-06T00:00:00Z";

/** A voltage source driving an LED with no ground reference — ERC_NO_GROUND. */
function ledNoGround(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_explain",
    projectId: "proj_explain",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "D1", componentId: "cmp_led_generic" },
    ],
    nets: [
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
    provenance: { source: "test", at: AT },
  };
}

function failedRun(): SimulationRun {
  return {
    irVersion: IR_VERSION,
    kind: "simulationRun",
    id: "sim_failed",
    netlistId: "net_x",
    engine: "ngspice",
    mode: "transient",
    status: "failed",
    provenance: { source: "test", at: AT },
  };
}

describe("copilot explain action", () => {
  it("cites the ERC rule id for a schematic with an electrical error", () => {
    const explanation = explainCircuit(ledNoGround(), [failedRun()]);
    expect(explanation.ercRules).toContain("ERC_NO_GROUND");
    expect(explanation.summary).toContain("ERC_NO_GROUND");
  });

  it("references the latest simulation run status", () => {
    const explanation = explainCircuit(ledNoGround(), [failedRun()]);
    expect(explanation.simStatus).toBe("failed");
    expect(explanation.summary.toLowerCase()).toContain("fail");
  });

  it("uses the LATEST run when several are present", () => {
    const older = failedRun();
    const newer: SimulationRun = { ...failedRun(), id: "sim_ok", status: "completed" };
    const explanation = explainCircuit(ledNoGround(), [older, newer]);
    expect(explanation.simStatus).toBe("completed");
  });

  it("is deterministic — identical input yields an identical summary", () => {
    const a = explainCircuit(ledNoGround(), [failedRun()]);
    const b = explainCircuit(ledNoGround(), [failedRun()]);
    expect(a.summary).toBe(b.summary);
  });

  it("handles a clean circuit with no runs without throwing", () => {
    const clean: Schematic = {
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_clean",
      projectId: "proj_clean",
      instances: [],
      nets: [],
      provenance: { source: "test", at: AT },
    };
    const explanation = explainCircuit(clean);
    expect(explanation.ercRules).toEqual([]);
    expect(explanation.simStatus).toBeUndefined();
  });
});
