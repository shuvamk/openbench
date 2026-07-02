import { describe, expect, it } from "vitest";
import { generateVirtualMachineConfig } from "../src/index";

/**
 * Acceptance tests for issue #10 (bullet 3) — virtual machine config for the
 * flash-to-virtual-MCU target. Phase 1 emits a qemu-xtensa-esp32 launch stub;
 * QEMU is chosen over Renode for ESP32 (open question Q2).
 */
describe("generateVirtualMachineConfig", () => {
  it("targets the qemu engine for esp32", () => {
    const machine = generateVirtualMachineConfig({ mcu: "esp32dev" });
    expect(machine.engine).toBe("qemu");
  });

  it("emits a qemu-xtensa-esp32 launch config stub", () => {
    const machine = generateVirtualMachineConfig({ mcu: "esp32dev" });
    expect(machine.config).toContain("qemu-system-xtensa");
    expect(machine.config).toContain("-machine esp32");
  });

  it("documents the QEMU-over-Renode decision (Q2) in the notes", () => {
    const machine = generateVirtualMachineConfig({ mcu: "esp32dev" });
    expect(machine.notes).toContain("QEMU");
    expect(machine.notes).toContain("Renode");
    expect(machine.notes).toContain("Q2");
  });

  it("throws for MCU families outside esp32 (Phase 1 scope)", () => {
    expect(() => generateVirtualMachineConfig({ mcu: "stm32f407vg" })).toThrowError(
      /unsupported mcu family/i,
    );
  });
});
