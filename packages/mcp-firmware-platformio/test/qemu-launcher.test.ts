import { describe, expect, it } from "vitest";
import {
  QemuProcessLauncher,
  generateVirtualMachineConfig,
} from "../src/index";

/**
 * Acceptance tests for issue #119 — the QEMU process launcher. It takes the
 * existing `generateVirtualMachineConfig` output and actually spawns
 * `qemu-system-xtensa` as a long-running child process (the process-launch half
 * of ADR-0011; splicing its stdio/GDB socket into the live-emulation loop is a
 * separately-filed follow-up). Feature-detected exactly like `PioCliBackend`: an
 * absent binary is a structured `engine-unavailable` result, never a throw.
 *
 * No real QEMU is started here — availability is probed against a name that
 * cannot exist, and the launch path runs through an injected fake `spawn`.
 */

const config = () => generateVirtualMachineConfig({ mcu: "esp32" });

/** A minimal fake child process capturing kill() calls. */
function fakeChild() {
  let kills = 0;
  return {
    pid: 4242,
    kill() {
      kills += 1;
    },
    get killCount() {
      return kills;
    },
  };
}

describe("QemuProcessLauncher", () => {
  it('is named "qemu-cli"', () => {
    expect(new QemuProcessLauncher().name).toBe("qemu-cli");
  });

  it("surfaces an absent qemu binary as a structured engine-unavailable failure (never throws)", async () => {
    const launcher = new QemuProcessLauncher({ qemuBinary: "definitely-not-real" });
    const result = await launcher.launch(config());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.log.toLowerCase()).toContain("engine-unavailable");
  });

  it("spawns qemu-system-xtensa with a GDB server (-s) flag and the machine argv from the config", async () => {
    const child = fakeChild();
    let spawnedBin = "";
    let spawnedArgv: string[] = [];
    const launcher = new QemuProcessLauncher({
      qemuBinary: "qemu-system-xtensa",
      isAvailable: () => true,
      spawn: (bin, argv) => {
        spawnedBin = bin;
        spawnedArgv = argv;
        return child;
      },
    });

    const result = await launcher.launch(config());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(spawnedBin).toBe("qemu-system-xtensa");
    // GDB stub flag for the (out-of-scope) live-emulation loop.
    expect(spawnedArgv).toContain("-s");
    // Machine argv is sourced from generateVirtualMachineConfig's output.
    expect(spawnedArgv).toContain("-machine");
    expect(spawnedArgv).toContain("esp32");
    expect(result.pid).toBe(4242);
    expect(typeof result.gdbPort).toBe("number");
  });

  it("stop() kills the process exactly once and is safe to call twice", async () => {
    const child = fakeChild();
    const launcher = new QemuProcessLauncher({
      isAvailable: () => true,
      spawn: () => child,
    });
    const result = await launcher.launch(config());
    if (!result.ok) throw new Error("expected success");
    result.stop();
    result.stop();
    expect(child.killCount).toBe(1);
  });
});
