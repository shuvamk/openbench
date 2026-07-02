import { describe, expect, it } from "vitest";
import { validateFirmwareTarget } from "../src/index";

/**
 * Acceptance tests for issue #5 — the `firmwareTarget` IR kind.
 * Mirrors the firmwareTarget example in .context/interchange-format.md.
 */
const minimalTarget = {
  irVersion: "0.1.0",
  kind: "firmwareTarget",
  id: "fw_00000000000000000000000000000000",
  projectId: "proj_00000000000000000000000000000000",
  mcu: "esp32dev",
  framework: "arduino",
  sourceRef: "git+https://github.com/openbench/blink#src",
  buildStatus: "success",
  artifact: {
    binary: "s3://openbench-artifacts/firmware.bin",
    elf: "s3://openbench-artifacts/firmware.elf",
  },
  flashTarget: {
    kind: "virtual",
    engine: "renode",
    machineConfig: "s3://openbench-artifacts/machine.repl",
  },
  provenance: { source: "mcp-firmware-platformio", at: "2026-07-02T00:00:00Z" },
};

const clone = () => structuredClone(minimalTarget) as Record<string, any>;

describe("validateFirmwareTarget", () => {
  it("accepts the canonical firmware target", () => {
    const result = validateFirmwareTarget(minimalTarget);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a pending build without an artifact", () => {
    const doc = clone();
    doc.buildStatus = "pending";
    delete doc.artifact;
    const result = validateFirmwareTarget(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an id not matching fw_*", () => {
    const doc = clone();
    doc.id = "firmware_1";
    const result = validateFirmwareTarget(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "id")).toBe(true);
  });

  it("rejects a framework outside arduino|esp-idf|zephyr", () => {
    const doc = clone();
    doc.framework = "mbed";
    const result = validateFirmwareTarget(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "framework")).toBe(true);
  });

  it("accepts esp-idf and zephyr frameworks", () => {
    for (const framework of ["esp-idf", "zephyr"]) {
      const doc = clone();
      doc.framework = framework;
      expect(validateFirmwareTarget(doc).valid).toBe(true);
    }
  });

  it("rejects a buildStatus outside pending|building|success|failed", () => {
    const doc = clone();
    doc.buildStatus = "ok";
    const result = validateFirmwareTarget(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "buildStatus")).toBe(true);
  });

  it("rejects a flashTarget.kind outside virtual|physical", () => {
    const doc = clone();
    doc.flashTarget.kind = "emulated";
    const result = validateFirmwareTarget(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "flashTarget.kind")).toBe(true);
  });

  it("rejects a flashTarget.engine outside renode|qemu", () => {
    const doc = clone();
    doc.flashTarget.engine = "ngspice";
    const result = validateFirmwareTarget(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "flashTarget.engine")).toBe(true);
  });

  it("accepts a physical flash target on qemu", () => {
    const doc = clone();
    doc.flashTarget = { kind: "physical", engine: "qemu" };
    const result = validateFirmwareTarget(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
