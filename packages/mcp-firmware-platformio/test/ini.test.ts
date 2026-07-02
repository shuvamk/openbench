import { describe, expect, it } from "vitest";
import { generatePlatformioIni } from "../src/index";

/**
 * Acceptance tests for issue #10 (bullet 1) — platformio.ini generation from
 * the firmwareTarget IR slice. The ini is a translation target, never the
 * source of truth (IR spec §design-principles).
 */
describe("generatePlatformioIni", () => {
  it("emits the canonical esp32dev/arduino ini verbatim", () => {
    const ini = generatePlatformioIni({ mcu: "esp32dev", framework: "arduino" });
    expect(ini).toBe(
      [
        "[env:esp32dev]",
        "platform = espressif32",
        "board = esp32dev",
        "framework = arduino",
        "monitor_speed = 115200",
        "",
      ].join("\n"),
    );
  });

  it("uses platform espressif32 for every esp32-family mcu", () => {
    for (const mcu of ["esp32dev", "esp32-s3-devkitc-1", "esp32c3"]) {
      const ini = generatePlatformioIni({ mcu, framework: "arduino" });
      expect(ini).toContain(`[env:${mcu}]`);
      expect(ini).toContain("platform = espressif32");
      expect(ini).toContain(`board = ${mcu}`);
    }
  });

  it("passes the framework through for arduino, esp-idf and zephyr", () => {
    for (const framework of ["arduino", "esp-idf", "zephyr"] as const) {
      const ini = generatePlatformioIni({ mcu: "esp32dev", framework });
      expect(ini).toContain(`framework = ${framework}`);
    }
  });

  it("defaults monitor_speed to 115200", () => {
    const ini = generatePlatformioIni({ mcu: "esp32dev", framework: "esp-idf" });
    expect(ini).toContain("monitor_speed = 115200");
  });

  it("honors an explicit monitorSpeed", () => {
    const ini = generatePlatformioIni({
      mcu: "esp32dev",
      framework: "arduino",
      monitorSpeed: 9600,
    });
    expect(ini).toContain("monitor_speed = 9600");
    expect(ini).not.toContain("115200");
  });

  it("throws for MCU families outside esp32 (Phase 1 scope)", () => {
    for (const mcu of ["uno", "stm32f407vg", "nrf52840"]) {
      expect(() => generatePlatformioIni({ mcu, framework: "arduino" })).toThrowError(
        /unsupported mcu family/i,
      );
    }
  });
});
