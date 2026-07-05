import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../lib/templates";
import {
  SHARE_URL_LIMIT,
  decodeShare,
  encodeShare,
  isShareError,
} from "../lib/share";

describe("share payload codec", () => {
  it("round-trips a project bundle: decodeShare(encodeShare(b)) deep-equals b", async () => {
    const bundle = createFromTemplate("rc-lowpass", "RC low-pass");
    const encoded = await encodeShare(bundle);
    expect(typeof encoded).toBe("string");
    const decoded = await decodeShare(encoded as string);
    expect(decoded).toEqual(bundle);
  });

  it("produces a URL-safe payload (no +, /, = or whitespace)", async () => {
    const bundle = createFromTemplate("basic-led", "LED");
    const encoded = (await encodeShare(bundle)) as string;
    expect(typeof encoded).toBe("string");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("compresses: a representative project encodes materially smaller than raw JSON (ratio < 1)", async () => {
    const bundle = createFromTemplate("playground", "Playground");
    const encoded = (await encodeShare(bundle)) as string;
    const raw = JSON.stringify(bundle);
    expect(encoded.length / raw.length).toBeLessThan(1);
  });

  it("returns a structured 'too large' error (never throws) when the payload exceeds the URL cap", async () => {
    const bundle = createFromTemplate("blank", "Oversized");
    // Bloat well past the URL-safe cap with many distinct instances.
    for (let i = 0; i < 20000; i++) {
      bundle.schematic.instances.push({
        instanceId: `R${i}`,
        componentId: "cmp_resistor_generic",
        parameterOverrides: { resistance: i * 7 + 1 },
      });
    }
    const result = await encodeShare(bundle);
    expect(isShareError(result)).toBe(true);
    if (isShareError(result)) {
      expect(result.error).toBe("too_large");
      expect(result.limit).toBe(SHARE_URL_LIMIT);
      expect(result.size).toBeGreaterThan(SHARE_URL_LIMIT);
    }
  });
});
