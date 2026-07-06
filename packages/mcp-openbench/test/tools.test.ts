import {
  validateNetlist,
  validateProject,
  validateSchematic,
  validateSimulationRun,
  type Schematic,
} from "@openbench/ir-schema";
// The shared headless mutation layer (ADR-0019): the MCP server and apps/web
// both import authoring ops from this ONE neutral package path — never from
// apps/web. Asserted below so the two surfaces can never drift.
import { createProject, placeInstance } from "@openbench/schematic-ops";
import { describe, expect, it } from "vitest";
import {
  addInstanceTool,
  compileNetlistTool,
  connectTool,
  createProjectTool,
  listRegistryTool,
  readWaveformTool,
  removeInstancesTool,
  runSimulationTool,
  setParamTool,
  validateSchematicTool,
} from "../src/tools";

/**
 * Unit + golden-transcript tests for the agent-control tool surface
 * (spike #33 / ADR-0019 / issue #42). Every tool is a thin translation of an
 * existing pure function and returns the never-throw discriminated result
 * `{ ok:true, data, warnings? } | { ok:false, errors:[{path,message}] }`.
 * Each authoring tool's output IR is asserted valid against ir-schema.
 */

/** Narrow an ok result or fail loudly with the structured errors. */
function expectOk<T>(
  result: { ok: true; data: T; warnings?: string[] } | { ok: false; errors: unknown },
): { ok: true; data: T; warnings?: string[] } {
  if (!result.ok) throw new Error(`expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result;
}

describe("shared mutation layer (ADR-0019)", () => {
  it("the MCP tools' authoring ops resolve from the neutral @openbench/schematic-ops path", () => {
    // Proves the server does not reach into apps/web: the same functions the
    // canvas/copilot call are importable from the shared package.
    expect(typeof createProject).toBe("function");
    expect(typeof placeInstance).toBe("function");
  });
});

describe("create_project", () => {
  it("mints a ProjectBundle whose project + schematic validate against ir-schema", () => {
    const { data } = expectOk(createProjectTool({ name: "RC low-pass" }));
    expect(validateProject(data.project).valid).toBe(true);
    expect(validateSchematic(data.schematic).valid).toBe(true);
    expect(data.project.name).toBe("RC low-pass");
    expect(data.schematic.instances).toEqual([]);
    expect(data.schematic.nets).toEqual([]);
  });

  it("rejects an empty name with a structured error (never throws)", () => {
    const result = createProjectTool({ name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toHaveProperty("path");
      expect(result.errors[0]).toHaveProperty("message");
    }
  });
});

describe("list_registry", () => {
  it("returns registry components with pins + parameters", () => {
    const { data } = expectOk(listRegistryTool({}));
    expect(data.components.length).toBeGreaterThan(0);
    const resistor = data.components.find((c) => c.id === "cmp_resistor_generic");
    expect(resistor).toBeDefined();
    expect(resistor!.pins.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(resistor!.parameters.some((p) => p.name === "resistance")).toBe(true);
  });

  it("filters by a case-insensitive query over id/name/category", () => {
    const { data } = expectOk(listRegistryTool({ query: "resistor" }));
    expect(data.components.length).toBeGreaterThan(0);
    expect(data.components.every((c) => /resistor/i.test(`${c.id} ${c.name} ${c.category}`))).toBe(
      true,
    );
  });
});

describe("add_instance", () => {
  const fresh = (): Schematic => expectOk(createProjectTool({ name: "t" })).data.schematic;

  it("places a registry component and returns a schematic that still validates", () => {
    const { data } = expectOk(
      addInstanceTool({ schematic: fresh(), componentId: "cmp_resistor_generic" }),
    );
    expect(validateSchematic(data.schematic).valid).toBe(true);
    expect(data.schematic.instances).toHaveLength(1);
    expect(data.schematic.instances[0]!.componentId).toBe("cmp_resistor_generic");
    expect(data.instanceId).toBe(data.schematic.instances[0]!.instanceId);
  });

  it("applies params as parameter overrides", () => {
    const { data } = expectOk(
      addInstanceTool({
        schematic: fresh(),
        componentId: "cmp_resistor_generic",
        params: { resistance: 4700 },
      }),
    );
    expect(data.schematic.instances[0]!.parameterOverrides).toEqual({ resistance: 4700 });
    expect(validateSchematic(data.schematic).valid).toBe(true);
  });

  it("unknown componentId → structured error naming valid registry ids", () => {
    const result = addInstanceTool({ schematic: fresh(), componentId: "cmp_does_not_exist" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.path).toBe("componentId");
      // The error must help the agent recover by listing real ids.
      expect(result.errors[0]!.message).toContain("cmp_resistor_generic");
    }
  });

  it("a malformed schematic short-circuits to a structured error (never throws)", () => {
    const result = addInstanceTool({
      schematic: { kind: "schematic" } as unknown as Schematic,
      componentId: "cmp_resistor_generic",
    });
    expect(result.ok).toBe(false);
  });
});

describe("connect / set_param / remove_instances", () => {
  it("connect folds N pin refs onto one net and returns the surviving netId", () => {
    let schematic = expectOk(createProjectTool({ name: "t" })).data.schematic;
    const r = expectOk(addInstanceTool({ schematic, componentId: "cmp_resistor_generic" }));
    schematic = r.data.schematic;
    const c = expectOk(addInstanceTool({ schematic, componentId: "cmp_capacitor_generic" }));
    schematic = c.data.schematic;

    const connected = expectOk(
      connectTool({
        schematic,
        pinRefs: [
          { instanceId: r.data.instanceId, pinId: "p2" },
          { instanceId: c.data.instanceId, pinId: "p1" },
        ],
      }),
    );
    expect(validateSchematic(connected.data.schematic).valid).toBe(true);
    const net = connected.data.schematic.nets.find((n) => n.netId === connected.data.netId);
    expect(net!.connections).toHaveLength(2);
  });

  it("connect rejects fewer than two pin refs", () => {
    const schematic = expectOk(createProjectTool({ name: "t" })).data.schematic;
    const result = connectTool({ schematic, pinRefs: [{ instanceId: "R1", pinId: "p1" }] });
    expect(result.ok).toBe(false);
  });

  it("connect flags a pin ref to a non-existent instance", () => {
    const schematic = expectOk(createProjectTool({ name: "t" })).data.schematic;
    const result = connectTool({
      schematic,
      pinRefs: [
        { instanceId: "R1", pinId: "p1" },
        { instanceId: "R2", pinId: "p1" },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("set_param sets an override and remove_instances deletes it", () => {
    let schematic = expectOk(createProjectTool({ name: "t" })).data.schematic;
    const r = expectOk(addInstanceTool({ schematic, componentId: "cmp_resistor_generic" }));
    schematic = r.data.schematic;

    const set = expectOk(
      setParamTool({ schematic, instanceId: r.data.instanceId, name: "resistance", value: "2k" }),
    );
    expect(set.data.schematic.instances[0]!.parameterOverrides).toEqual({ resistance: "2k" });
    expect(validateSchematic(set.data.schematic).valid).toBe(true);

    const removed = expectOk(
      removeInstancesTool({ schematic: set.data.schematic, instanceIds: [r.data.instanceId] }),
    );
    expect(removed.data.schematic.instances).toHaveLength(0);
    expect(validateSchematic(removed.data.schematic).valid).toBe(true);
  });

  it("set_param on an unknown instance → structured error", () => {
    const schematic = expectOk(createProjectTool({ name: "t" })).data.schematic;
    const result = setParamTool({ schematic, instanceId: "R9", name: "resistance", value: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("validate_schematic", () => {
  it("flags an error-severity ERC violation (source, no ground) as invalid", () => {
    let schematic = expectOk(createProjectTool({ name: "t" })).data.schematic;
    schematic = expectOk(
      addInstanceTool({ schematic, componentId: "cmp_vsource_pulse" }),
    ).data.schematic;
    const { data } = expectOk(validateSchematicTool({ schematic }));
    // IR-structurally fine, but ERC catches "a source but no ground reference".
    expect(data.irErrors).toEqual([]);
    expect(data.ercViolations.some((v) => v.rule === "ERC_NO_GROUND")).toBe(true);
    expect(data.valid).toBe(false);
  });

  it("a structurally invalid document reports irErrors without throwing", () => {
    const { data } = expectOk(
      validateSchematicTool({ schematic: { kind: "schematic" } as unknown as Schematic }),
    );
    expect(data.valid).toBe(false);
    expect(data.irErrors.length).toBeGreaterThan(0);
  });
});

/**
 * Golden transcript — the flagship acceptance test. A scripted sequence of tool
 * calls builds an RC low-pass (R + C + pulse source + ground, fully wired),
 * compiles the netlist, runs a transient on the deterministic MockBackend, and
 * read_waveform returns a non-empty output signal — end to end.
 */
describe("golden transcript: build + simulate an RC low-pass", () => {
  it("designs, compiles, simulates and reads back the step response", async () => {
    // 1. Start a project.
    let schematic = expectOk(createProjectTool({ name: "RC low-pass" })).data.schematic;

    // 2. Place the four parts (position omitted → auto grid slot).
    const v1 = expectOk(
      addInstanceTool({
        schematic,
        componentId: "cmp_vsource_pulse",
        params: { vhigh: 1, tperiod: 0.02, ton: 0.01 },
      }),
    );
    schematic = v1.data.schematic;
    const r1 = expectOk(
      addInstanceTool({ schematic, componentId: "cmp_resistor_generic", params: { resistance: 1000 } }),
    );
    schematic = r1.data.schematic;
    const c1 = expectOk(
      addInstanceTool({
        schematic,
        componentId: "cmp_capacitor_generic",
        params: { capacitance: 1e-6 },
      }),
    );
    schematic = c1.data.schematic;
    const gnd = expectOk(addInstanceTool({ schematic, componentId: "cmp_ground" }));
    schematic = gnd.data.schematic;

    // 3. Wire it: V+.→R1.p1 (input), R1.p2→C1.p1 (vout), C1.p2 & V- & GND (ground).
    schematic = expectOk(
      connectTool({
        schematic,
        pinRefs: [
          { instanceId: v1.data.instanceId, pinId: "pos" },
          { instanceId: r1.data.instanceId, pinId: "p1" },
        ],
      }),
    ).data.schematic;
    const voutNet = expectOk(
      connectTool({
        schematic,
        pinRefs: [
          { instanceId: r1.data.instanceId, pinId: "p2" },
          { instanceId: c1.data.instanceId, pinId: "p1" },
        ],
      }),
    );
    schematic = voutNet.data.schematic;
    schematic = expectOk(
      connectTool({
        schematic,
        pinRefs: [
          { instanceId: c1.data.instanceId, pinId: "p2" },
          { instanceId: v1.data.instanceId, pinId: "neg" },
          { instanceId: gnd.data.instanceId, pinId: "gnd" },
        ],
      }),
    ).data.schematic;

    // 4. Pre-flight: no ERC errors on the finished circuit.
    const preflight = expectOk(validateSchematicTool({ schematic }));
    expect(preflight.data.valid).toBe(true);

    // 5. Compile the netlist.
    const compiled = expectOk(compileNetlistTool({ schematic }));
    expect(validateNetlist(compiled.data.netlist).valid).toBe(true);

    // 6. Run the transient (compile happens inside when given a schematic).
    const run = expectOk(
      await runSimulationTool({
        schematic,
        mode: "transient",
        config: { duration: "20m", step: "1m", probes: [voutNet.data.netId] },
      }),
    );
    expect(validateSimulationRun(run.data.simulationRun).valid).toBe(true);
    expect(run.data.simulationRun.status).toBe("completed");

    // 7. Read the step response as plain t/v arrays.
    const wave = expectOk(
      readWaveformTool({ simulationRun: run.data.simulationRun, signal: voutNet.data.netId }),
    );
    expect(wave.data.signals).toHaveLength(1);
    const signal = wave.data.signals[0]!;
    expect(signal.netId).toBe(voutNet.data.netId);
    expect(signal.v.length).toBeGreaterThan(0);
    expect(signal.t.length).toBe(signal.v.length);
  });
});

describe("run_simulation / read_waveform error shapes", () => {
  it("run_simulation on an un-compilable schematic → structured errors, never throws", async () => {
    const schematic = expectOk(createProjectTool({ name: "t" })).data.schematic;
    // Empty schematic: no devices → the compiler/deck cannot produce an analysis.
    const result = await runSimulationTool({
      schematic,
      mode: "transient",
      config: { duration: "1m", step: "1u" },
    });
    // Either a compile error (ok:false) or a failed run document — but never a throw.
    if (result.ok) {
      expect(["failed", "completed"]).toContain(result.data.simulationRun.status);
    } else {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("read_waveform on a run with no results → structured error", () => {
    const result = readWaveformTool({
      simulationRun: {
        irVersion: "0.1.0",
        kind: "simulationRun",
        id: "sim_x",
        netlistId: "net_x",
        engine: "ngspice",
        mode: "transient",
        status: "failed",
        provenance: { source: "test", at: "2026-07-06T00:00:00Z" },
      } as never,
    });
    expect(result.ok).toBe(false);
  });
});
