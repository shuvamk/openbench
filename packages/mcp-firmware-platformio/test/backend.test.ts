import { describe, expect, it } from "vitest";
import {
  MockBackend,
  PioCliBackend,
  type FirmwareBackend,
} from "../src/index";

/**
 * Acceptance tests for issue #10 (bullet 2) — the FirmwareBackend seam.
 * MockBackend is fully deterministic; PioCliBackend is only exercised on its
 * feature-detection ("pio" binary absent) path in unit tests.
 */
const INI = "[env:esp32dev]\nplatform = espressif32\nboard = esp32dev\nframework = arduino\nmonitor_speed = 115200\n";

describe("MockBackend", () => {
  it("implements FirmwareBackend with a stable name", () => {
    const backend: FirmwareBackend = new MockBackend();
    expect(backend.name).toBe("mock");
  });

  it("succeeds with deterministic virtual artifact paths", async () => {
    const result = await new MockBackend().build(INI, "/virtual/src");
    expect(result.ok).toBe(true);
    expect(result.binaryPath).toBe("/virtual/out/firmware.bin");
    expect(result.elfPath).toBe("/virtual/out/firmware.elf");
    expect(result.log.length).toBeGreaterThan(0);
  });

  it("is deterministic across builds", async () => {
    const backend = new MockBackend();
    const first = await backend.build(INI, "/virtual/src");
    const second = await backend.build(INI, "/virtual/src");
    expect(second).toEqual(first);
  });

  it("fails with the injected failure message and no artifacts", async () => {
    const result = await new MockBackend({ fail: "undefined reference to `setup'" }).build(
      INI,
      "/virtual/src",
    );
    expect(result.ok).toBe(false);
    expect(result.binaryPath).toBeUndefined();
    expect(result.elfPath).toBeUndefined();
    expect(result.log).toContain("undefined reference to `setup'");
  });
});

describe("PioCliBackend (pio absent)", () => {
  it("implements FirmwareBackend with a stable name", () => {
    const backend: FirmwareBackend = new PioCliBackend();
    expect(backend.name).toBe("pio-cli");
  });

  it("resolves engine-unavailable (never throws) when the pio binary is missing", async () => {
    const backend = new PioCliBackend({
      pioBinary: "openbench-definitely-not-a-real-pio-binary",
    });
    await expect(backend.build(INI, "/virtual/src")).resolves.toEqual({
      ok: false,
      log: "engine-unavailable: PlatformIO CLI not found",
    });
  });
});
