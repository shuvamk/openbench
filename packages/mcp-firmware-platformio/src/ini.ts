/**
 * platformio.ini generation (issue #10, bullet 1).
 *
 * The ini is a translation target generated from the firmwareTarget IR —
 * never the source of truth (IR spec §design-principles).
 */

/** The slice of the firmwareTarget IR needed to emit a platformio.ini. */
export interface PlatformioIniTarget {
  mcu: string;
  framework: "arduino" | "esp-idf" | "zephyr";
  monitorSpeed?: number;
}

export const DEFAULT_MONITOR_SPEED = 115200;

/**
 * MCU family → PlatformIO platform. Phase 1 supports only the esp32 family
 * (espressif32); anything else is a structured error at the call site.
 */
export function platformForMcu(mcu: string): string {
  if (mcu.startsWith("esp32")) return "espressif32";
  throw new Error(
    `unsupported MCU family for "${mcu}": only the esp32 family ` +
      "(platform espressif32) is supported in Phase 1",
  );
}

export function generatePlatformioIni(target: PlatformioIniTarget): string {
  const platform = platformForMcu(target.mcu);
  const monitorSpeed = target.monitorSpeed ?? DEFAULT_MONITOR_SPEED;
  return [
    `[env:${target.mcu}]`,
    `platform = ${platform}`,
    `board = ${target.mcu}`,
    `framework = ${target.framework}`,
    `monitor_speed = ${monitorSpeed}`,
    "",
  ].join("\n");
}
