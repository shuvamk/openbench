/**
 * @openbench/mcp-firmware-platformio — PlatformIO engine adapter (issue #10).
 *
 * firmwareTarget IR in → platformio.ini + backend build → updated
 * firmwareTarget IR out, provenance-stamped by this adapter. Engines only
 * ever talk through the IR; platformio.ini is a generated translation
 * target, never the source of truth.
 */
import { validateFirmwareTarget, type FirmwareTarget } from "@openbench/ir-schema";
import type { FirmwareBackend, FirmwareBuildResult } from "./backend";
import { generatePlatformioIni } from "./ini";

export {
  DEFAULT_MONITOR_SPEED,
  generatePlatformioIni,
  platformForMcu,
  type PlatformioIniTarget,
} from "./ini";
export {
  MockBackend,
  PioCliBackend,
  type FirmwareBackend,
  type FirmwareBuildResult,
} from "./backend";
export { generateVirtualMachineConfig, type VirtualMachineConfig } from "./machine";
export {
  RspMemoryReader,
  buildReadMemoryPacket,
  frame,
  parseMemoryResponse,
  rspChecksum,
  type MemoryReader,
  type RspTransport,
} from "./gdb-rsp";
export {
  GPIO_ENABLE1_REG,
  GPIO_ENABLE_REG,
  GPIO_OUT1_REG,
  GPIO_OUT_REG,
  GpioPoller,
  pollGpio,
  type GpioEvent,
  type PollGpioOptions,
} from "./gpio-poller";
export {
  EDGE_RAMP_SECONDS,
  ROUT_OHMS,
  VOH_VOLTS,
  VOL_VOLTS,
  gpioEventsToPwl,
  type Esp32PinNetMap,
  type GpioPwlOptions,
  type GpioPwlResult,
  type PinDriveEvent,
  type PwlSource,
} from "./gpio-pwl";
export { validateFirmwareTarget, type FirmwareTarget };

/** Provenance source stamped on every document this adapter produces. */
export const ENGINE_SOURCE = "mcp-firmware-platformio";

export interface BuildFirmwareOptions {
  /** Injectable clock (ISO-8601) for deterministic provenance in tests. */
  now?: string;
}

/**
 * Build the firmware described by a firmwareTarget IR document through the
 * given backend and return the updated document (the input is never
 * mutated): buildStatus success|failed, artifact { binary, elf } on
 * success, provenance stamped by this adapter. Engine failures — including
 * an unavailable pio CLI and out-of-scope MCU families — surface as a
 * failed document, never as a throw.
 */
export async function buildFirmware(
  target: FirmwareTarget,
  backend: FirmwareBackend,
  opts: BuildFirmwareOptions = {},
): Promise<FirmwareTarget> {
  const at = opts.now ?? new Date().toISOString();

  let result: FirmwareBuildResult;
  try {
    const ini = generatePlatformioIni({ mcu: target.mcu, framework: target.framework });
    result = await backend.build(ini, target.sourceRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = { ok: false, log: message };
  }

  const updated: FirmwareTarget = {
    ...structuredClone(target),
    buildStatus: result.ok ? "success" : "failed",
    provenance: { source: ENGINE_SOURCE, at },
  };
  if (result.ok) {
    updated.artifact = {
      ...(result.binaryPath !== undefined ? { binary: result.binaryPath } : {}),
      ...(result.elfPath !== undefined ? { elf: result.elfPath } : {}),
    };
  } else {
    delete updated.artifact;
  }
  return updated;
}
