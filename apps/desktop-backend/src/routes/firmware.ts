/**
 * Firmware build route (issue #119, ADR-0024). Exposes the PlatformIO adapter
 * through the loopback desktop backend: `POST /firmware/build` takes a
 * firmwareTarget IR document, runs it through the injected `FirmwareBackend`
 * (the real `PioCliBackend` in production, a `MockBackend` in tests), and returns
 * the `FirmwareBuildResult`. All failure modes are structured JSON — a bad body
 * is a 400, a build failure is a 200 with `ok:false`; nothing throws to the caller.
 */
import {
  generatePlatformioIni,
  type FirmwareBackend,
  type FirmwareBuildResult,
} from "@openbench/mcp-firmware-platformio";
import { validateFirmwareTarget, type FirmwareTarget } from "@openbench/ir-schema";

export interface FirmwareRouteResponse {
  status: number;
  body: FirmwareBuildResult | { error: string };
}

/**
 * Build the firmware described by a request body `{ firmwareTarget }`. Pure and
 * total: any invalid input yields a structured 400, any backend rejection yields
 * a failed `FirmwareBuildResult` — never a throw.
 */
export async function handleFirmwareBuild(
  rawBody: string,
  backend: FirmwareBackend,
): Promise<FirmwareRouteResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "request body is not valid JSON" } };
  }

  const firmwareTarget = (parsed as { firmwareTarget?: unknown } | null)?.firmwareTarget;
  const validation = validateFirmwareTarget(firmwareTarget);
  if (!validation.valid) {
    const detail = validation.errors[0]?.message ?? "invalid firmwareTarget";
    return { status: 400, body: { error: `invalid firmwareTarget: ${detail}` } };
  }

  const target = firmwareTarget as FirmwareTarget;
  try {
    const ini = generatePlatformioIni({ mcu: target.mcu, framework: target.framework });
    const result = await backend.build(ini, target.sourceRef);
    return { status: 200, body: result };
  } catch (cause) {
    // A backend that throws (e.g. an out-of-scope MCU family) still returns a
    // structured failed result rather than a 500.
    const message = cause instanceof Error ? cause.message : String(cause);
    return { status: 200, body: { ok: false, log: message } };
  }
}
