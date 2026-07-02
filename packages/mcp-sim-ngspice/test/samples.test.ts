import { describe, expect, it } from "vitest";
import { decodeSamples, encodeSamples } from "../src/samples";

/**
 * Acceptance (issue #9, bullet 4): encode/decode round-trips Float64Array.
 */
describe("encodeSamples / decodeSamples", () => {
  it("encodes to a data:application/octet-stream;base64 URI", () => {
    const encoded = encodeSamples(new Float64Array([0, 1, -2.5]));
    expect(encoded.startsWith("data:application/octet-stream;base64,")).toBe(true);
  });

  it("round-trips a Float64Array exactly", () => {
    const samples = new Float64Array([
      0,
      1,
      -1,
      Math.PI,
      -2.5e-9,
      3.3e12,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
    ]);
    const decoded = decodeSamples(encodeSamples(samples));
    expect(decoded).toBeInstanceOf(Float64Array);
    expect(Array.from(decoded)).toEqual(Array.from(samples));
  });

  it("round-trips an empty Float64Array", () => {
    const decoded = decodeSamples(encodeSamples(new Float64Array(0)));
    expect(decoded.length).toBe(0);
  });

  it("round-trips a large array (256 samples)", () => {
    const samples = new Float64Array(256);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 7) * i;
    const decoded = decodeSamples(encodeSamples(samples));
    expect(Array.from(decoded)).toEqual(Array.from(samples));
  });

  it("throws a clear error for http(s)/s3 sample URLs (pass-through, not fetchable)", () => {
    for (const url of [
      "https://example.com/vcc.bin",
      "http://example.com/vcc.bin",
      "s3://openbench-results/vcc.bin",
    ]) {
      expect(() => decodeSamples(url)).toThrowError(/remote samples not fetchable here/);
    }
  });

  it("throws on strings that are not data: URIs at all", () => {
    expect(() => decodeSamples("just some bytes")).toThrow();
  });

  it("throws when the payload is not a whole number of float64s", () => {
    // "AAAA" decodes to 3 bytes — not a multiple of 8.
    expect(() => decodeSamples("data:application/octet-stream;base64,AAAA")).toThrow();
  });
});
