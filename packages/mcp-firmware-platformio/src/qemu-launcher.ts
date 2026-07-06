/**
 * QEMU process launcher (issue #119, ADR-0011). The process-launch half of
 * flash-to-virtual-MCU: take a {@link VirtualMachineConfig} from
 * `generateVirtualMachineConfig` and actually spawn `qemu-system-xtensa` as a
 * long-running child process, exposing `{ pid, gdbPort, stop() }`.
 *
 * Feature-detected exactly like `PioCliBackend`: an absent `qemu-system-xtensa`
 * binary is a structured `engine-unavailable` result, never a throw. The binary
 * path and the `spawn`/availability hooks are injectable, so the per-OS bundling
 * issue points it at the bundled absolute path and CI never starts a real QEMU.
 *
 * OUT of scope (separately-filed follow-up): splicing the spawned process's GDB
 * socket into the existing `gdb-rsp.ts`/`gpio-poller.ts` transport — the live
 * emulation/observe loop. This class only makes QEMU launchable as an OS process.
 */
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import type { VirtualMachineConfig } from "./machine";

/** The minimum a spawned child must expose for the launcher to manage it. */
export interface QemuChildProcess {
  pid?: number;
  /** Terminate the process. Node's `ChildProcess.kill` is assignable here. */
  kill(): void;
}

export type QemuSpawn = (
  binary: string,
  argv: string[],
  options: { stdio: "ignore" },
) => QemuChildProcess;

export interface QemuLauncherOptions {
  /** Binary name or absolute path; defaults to `qemu-system-xtensa` on PATH. */
  qemuBinary?: string;
  /** GDB stub TCP port exposed by `-s`/`-gdb`; defaults to QEMU's own 1234. */
  gdbPort?: number;
  /** Availability probe; defaults to `qemuBinary --version` exiting 0. */
  isAvailable?: () => boolean | Promise<boolean>;
  /** Injectable process spawner (defaults to `node:child_process` spawn). */
  spawn?: QemuSpawn;
}

/** A structured launch outcome — never a throw. */
export type QemuLaunchResult =
  | { ok: false; log: string }
  | { ok: true; pid: number | undefined; gdbPort: number; stop: () => void };

/** QEMU's `-s` shorthand is `-gdb tcp::1234`; we surface the port explicitly. */
const DEFAULT_GDB_PORT = 1234;

/**
 * Parse the `qemu-system-xtensa` argv out of a {@link VirtualMachineConfig}'s
 * `config` text (the launch stub `generateVirtualMachineConfig` emits): take the
 * tokens after the binary name, dropping line-continuation backslashes.
 */
export function qemuArgvFromConfig(config: VirtualMachineConfig): string[] {
  const flat = config.config
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join(" ")
    .replace(/\\/g, " ");
  const tokens = flat.split(/\s+/).filter((t) => t.length > 0);
  const binIndex = tokens.findIndex((t) => t === "qemu-system-xtensa");
  return binIndex === -1 ? [] : tokens.slice(binIndex + 1);
}

export class QemuProcessLauncher {
  readonly name = "qemu-cli";
  private readonly qemuBinary: string;
  private readonly gdbPort: number;
  private readonly isAvailable: () => boolean | Promise<boolean>;
  private readonly spawn: QemuSpawn;

  constructor(options: QemuLauncherOptions = {}) {
    this.qemuBinary = options.qemuBinary ?? "qemu-system-xtensa";
    this.gdbPort = options.gdbPort ?? DEFAULT_GDB_PORT;
    this.isAvailable = options.isAvailable ?? (() => defaultQemuAvailable(this.qemuBinary));
    this.spawn = options.spawn ?? defaultSpawn;
  }

  /**
   * Launch QEMU for the given machine config. Resolves to a structured failure
   * (`engine-unavailable`, or the spawn error) rather than throwing.
   */
  async launch(machineConfig: VirtualMachineConfig): Promise<QemuLaunchResult> {
    if (!(await this.isAvailable())) {
      return {
        ok: false,
        log: `qemu engine-unavailable: binary "${this.qemuBinary}" not found on PATH`,
      };
    }

    // Base argv from the config's launch stub, plus the GDB stub flag `-s` the
    // (out-of-scope) live-emulation loop needs. `-s` is not already in the stub.
    const argv = [...qemuArgvFromConfig(machineConfig)];
    if (!argv.includes("-s") && !argv.includes("-gdb")) argv.push("-s");

    let child: QemuChildProcess;
    try {
      child = this.spawn(this.qemuBinary, argv, { stdio: "ignore" });
    } catch (cause) {
      return { ok: false, log: `qemu launch failed: ${cause instanceof Error ? cause.message : String(cause)}` };
    }

    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      try {
        child.kill();
      } catch {
        // A process that already exited is fine — stop() is best-effort.
      }
    };

    return { ok: true, pid: child.pid, gdbPort: this.gdbPort, stop };
  }
}

/** `qemu-system-xtensa --version` exits 0 iff the binary resolves. */
function defaultQemuAvailable(binary: string): boolean {
  try {
    const probe = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 5000 });
    return probe.error === undefined && probe.status === 0;
  } catch {
    return false;
  }
}

/** Default long-running spawn via `node:child_process` (untested in CI). */
function defaultSpawn(binary: string, argv: string[], options: { stdio: "ignore" }): QemuChildProcess {
  return nodeSpawn(binary, argv, { stdio: options.stdio, detached: false });
}
