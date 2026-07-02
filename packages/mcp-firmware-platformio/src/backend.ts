/**
 * FirmwareBackend seam (issue #10, bullet 2).
 *
 * buildFirmware talks to a backend, never to PlatformIO directly, so the
 * deterministic MockBackend and the real PioCliBackend are interchangeable.
 * Backends resolve structured results — they never throw raw engine output
 * (engine-status production-readiness checklist).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FirmwareBuildResult {
  ok: boolean;
  binaryPath?: string;
  elfPath?: string;
  log: string;
}

export interface FirmwareBackend {
  name: string;
  build(iniText: string, sourceDir: string): Promise<FirmwareBuildResult>;
}

/** Deterministic in-memory backend for tests and virtual-only environments. */
export class MockBackend implements FirmwareBackend {
  readonly name = "mock";
  private readonly fail?: string;

  constructor(options: { fail?: string } = {}) {
    this.fail = options.fail;
  }

  async build(_iniText: string, sourceDir: string): Promise<FirmwareBuildResult> {
    if (this.fail !== undefined) {
      return { ok: false, log: `mock: build failed: ${this.fail}` };
    }
    return {
      ok: true,
      binaryPath: "/virtual/out/firmware.bin",
      elfPath: "/virtual/out/firmware.elf",
      log: `mock: pio run simulated for ${sourceDir}`,
    };
  }
}

const ENGINE_UNAVAILABLE_LOG = "engine-unavailable: PlatformIO CLI not found";

/**
 * Real PlatformIO CLI backend. Feature-detects the `pio` binary; when it is
 * absent (CI, Vercel, most dev machines) build() resolves a structured
 * engine-unavailable result instead of throwing. The real `pio run` path is
 * implemented but only exercised where pio exists — unit tests cover the
 * feature-detection path only.
 */
export class PioCliBackend implements FirmwareBackend {
  readonly name = "pio-cli";
  private readonly pioBinary: string;

  constructor(options: { pioBinary?: string } = {}) {
    this.pioBinary = options.pioBinary ?? "pio";
  }

  private pioAvailable(): boolean {
    try {
      const probe = spawnSync(this.pioBinary, ["--version"], { encoding: "utf8" });
      return probe.error === undefined && probe.status === 0;
    } catch {
      return false;
    }
  }

  async build(iniText: string, sourceDir: string): Promise<FirmwareBuildResult> {
    if (!this.pioAvailable()) {
      return { ok: false, log: ENGINE_UNAVAILABLE_LOG };
    }
    try {
      const projectDir = mkdtempSync(join(tmpdir(), "openbench-pio-"));
      writeFileSync(join(projectDir, "platformio.ini"), iniText, "utf8");
      const srcDir = join(projectDir, "src");
      if (existsSync(sourceDir)) {
        cpSync(sourceDir, srcDir, { recursive: true });
      } else {
        mkdirSync(srcDir, { recursive: true });
      }

      const run = spawnSync(this.pioBinary, ["run", "-d", projectDir], {
        encoding: "utf8",
      });
      const log = `${run.stdout ?? ""}${run.stderr ?? ""}`;
      if (run.error !== undefined || run.status !== 0) {
        const reason = run.error ? `: ${run.error.message}` : "";
        return { ok: false, log: log.length > 0 ? log : `pio run failed${reason}` };
      }

      const buildDir = join(projectDir, ".pio", "build", envNameFrom(iniText));
      const binaryPath = join(buildDir, "firmware.bin");
      const elfPath = join(buildDir, "firmware.elf");
      return {
        ok: true,
        ...(existsSync(binaryPath) ? { binaryPath } : {}),
        ...(existsSync(elfPath) ? { elfPath } : {}),
        log,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, log: `pio run failed: ${message}` };
    }
  }
}

function envNameFrom(iniText: string): string {
  const match = /^\[env:([^\]]+)\]/m.exec(iniText);
  return match?.[1] ?? "default";
}
