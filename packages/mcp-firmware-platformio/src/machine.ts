/**
 * Virtual-machine config generation for flash-to-virtual-MCU (issue #10,
 * bullet 3).
 *
 * Q2 resolution: Renode's Xtensa/ESP32 support is limited upstream, so QEMU
 * (qemu-xtensa-esp32) is the Phase 1 emulation engine for the esp32 family.
 * Phase 1 emits a launch-config stub only; flash-to-emulator execution is
 * not wired yet.
 */
import { platformForMcu } from "./ini";

export interface VirtualMachineConfig {
  engine: "qemu";
  notes: string;
  config: string;
}

export function generateVirtualMachineConfig(target: { mcu: string }): VirtualMachineConfig {
  // Same Phase 1 family gate as ini generation: esp32 only.
  platformForMcu(target.mcu);
  return {
    engine: "qemu",
    notes:
      "QEMU (qemu-xtensa-esp32) chosen over Renode as the Phase 1 virtual-flash " +
      "engine for ESP32 — Renode's Xtensa/ESP32 support is limited upstream " +
      "(resolves open question Q2). This is a launch-config stub only; " +
      "flash-to-emulator execution is not wired yet.",
    config: [
      `# qemu-xtensa-esp32 launch config for ${target.mcu} (Phase 1 stub — not executed yet)`,
      "qemu-system-xtensa \\",
      "  -machine esp32 \\",
      "  -nographic \\",
      "  -drive file=firmware.bin,if=mtd,format=raw \\",
      "  -serial mon:stdio",
      "",
    ].join("\n"),
  };
}
