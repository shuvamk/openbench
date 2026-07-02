import { describe, expect, it } from "vitest";
import { validateFirmwareTarget, type FirmwareTarget } from "@openbench/ir-schema";
import { buildFirmware, MockBackend, PioCliBackend } from "../src/index";

/**
 * Acceptance tests for issue #10 (bullet 4) — buildFirmware returns an
 * updated firmwareTarget IR document (never mutates the input) that passes
 * validateFirmwareTarget, with provenance stamped by this adapter.
 */
const NOW = "2026-07-02T12:00:00Z";

const baseTarget: FirmwareTarget = {
  irVersion: "0.1.0",
  kind: "firmwareTarget",
  id: "fw_blink_esp32",
  projectId: "proj_blink",
  mcu: "esp32dev",
  framework: "arduino",
  sourceRef: "git+https://github.com/openbench/blink#src",
  buildStatus: "pending",
  flashTarget: { kind: "virtual", engine: "qemu" },
  provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
};

const cloneTarget = (): FirmwareTarget => structuredClone(baseTarget);

describe("buildFirmware", () => {
  it("returns buildStatus success with binary+elf artifact on a green build", async () => {
    const updated = await buildFirmware(cloneTarget(), new MockBackend(), { now: NOW });
    expect(updated.buildStatus).toBe("success");
    expect(updated.artifact).toEqual({
      binary: "/virtual/out/firmware.bin",
      elf: "/virtual/out/firmware.elf",
    });
  });

  it("stamps provenance with source mcp-firmware-platformio and the injected clock", async () => {
    const updated = await buildFirmware(cloneTarget(), new MockBackend(), { now: NOW });
    expect(updated.provenance).toEqual({ source: "mcp-firmware-platformio", at: NOW });
  });

  it("stamps a valid ISO-8601 timestamp when no clock is injected", async () => {
    const updated = await buildFirmware(cloneTarget(), new MockBackend());
    expect(new Date(updated.provenance.at).toString()).not.toBe("Invalid Date");
  });

  it("produces a document that passes validateFirmwareTarget on success", async () => {
    const updated = await buildFirmware(cloneTarget(), new MockBackend(), { now: NOW });
    const result = validateFirmwareTarget(updated);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("returns buildStatus failed without an artifact on a failing build", async () => {
    const updated = await buildFirmware(
      cloneTarget(),
      new MockBackend({ fail: "collect2: ld returned 1 exit status" }),
      { now: NOW },
    );
    expect(updated.buildStatus).toBe("failed");
    expect(updated.artifact).toBeUndefined();
    const result = validateFirmwareTarget(updated);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("fails structurally (no throw) for MCU families outside esp32", async () => {
    const target = { ...cloneTarget(), mcu: "stm32f407vg" };
    const updated = await buildFirmware(target, new MockBackend(), { now: NOW });
    expect(updated.buildStatus).toBe("failed");
    expect(updated.artifact).toBeUndefined();
    expect(validateFirmwareTarget(updated).valid).toBe(true);
  });

  it("fails structurally when the pio CLI is unavailable", async () => {
    const backend = new PioCliBackend({
      pioBinary: "openbench-definitely-not-a-real-pio-binary",
    });
    const updated = await buildFirmware(cloneTarget(), backend, { now: NOW });
    expect(updated.buildStatus).toBe("failed");
    expect(updated.artifact).toBeUndefined();
    expect(validateFirmwareTarget(updated).valid).toBe(true);
  });

  it("does not mutate the input document", async () => {
    const input = cloneTarget();
    await buildFirmware(input, new MockBackend(), { now: NOW });
    expect(input).toEqual(baseTarget);
  });
});
