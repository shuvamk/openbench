import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { createCopilot, resolveCopilotMode } from "../lib/copilot/engine";

/**
 * Issue #43 acceptance — the model-access seam is key-optional (mirrors
 * ADR-0003). With no API key the panel runs in a scripted/mock mode, so the
 * keyless deploy and the test suite work without any network access.
 */

const AT = "2026-07-06T00:00:00Z";

function emptySchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_engine",
    projectId: "proj_engine",
    instances: [],
    nets: [],
    provenance: { source: "test", at: AT },
  };
}

describe("copilot engine — key-optional mock seam", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    // Any network access in mock mode is a test failure.
    if (typeof globalThis.fetch === "function") {
      fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        throw new Error("mock mode must not hit the network");
      });
    }
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("selects mock mode when no API key is configured", () => {
    expect(resolveCopilotMode({})).toBe("mock");
    expect(resolveCopilotMode({ apiKey: "" })).toBe("mock");
  });

  it("selects live mode only when an API key is present", () => {
    expect(resolveCopilotMode({ apiKey: "sk-test" })).toBe("live");
  });

  it("createCopilot defaults to mock mode and proposes without network", () => {
    const copilot = createCopilot();
    expect(copilot.mode).toBe("mock");

    const proposal = copilot.propose(emptySchematic(), "add a resistor");
    expect(proposal).not.toBeNull();
    expect(proposal!.toolCall).toEqual({
      name: "add_instance",
      args: { componentId: "cmp_resistor_generic" },
    });
    // The proposal is a real IR mutation, not a black box.
    expect(proposal!.after.instances.map((i) => i.instanceId)).toEqual(["R1"]);
  });

  it("maps recognised part keywords to add_instance tool-calls", () => {
    const copilot = createCopilot();
    const cap = copilot.propose(emptySchematic(), "put a capacitor here");
    expect(cap!.toolCall.args.componentId).toBe("cmp_capacitor_generic");

    const gnd = copilot.propose(emptySchematic(), "add a ground symbol");
    expect(gnd!.toolCall.args.componentId).toBe("cmp_ground");
  });

  it("returns null when the prompt maps to no known action", () => {
    const copilot = createCopilot();
    expect(copilot.propose(emptySchematic(), "tell me a joke")).toBeNull();
  });
});
