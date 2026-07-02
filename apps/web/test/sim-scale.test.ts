import { describe, expect, it } from "vitest";
import {
  buildPolylinePoints,
  formatSi,
  niceTicks,
  scaleLinear,
} from "../lib/sim/scale";

describe("scaleLinear", () => {
  it("maps a domain onto a range linearly", () => {
    const scale = scaleLinear([0, 10], [0, 100]);
    expect(scale(0)).toBe(0);
    expect(scale(5)).toBe(50);
    expect(scale(10)).toBe(100);
  });

  it("handles negative domain values", () => {
    const scale = scaleLinear([-5, 5], [0, 100]);
    expect(scale(-5)).toBe(0);
    expect(scale(0)).toBe(50);
    expect(scale(5)).toBe(100);
    expect(scale(-10)).toBe(-50); // extrapolates, no clamping
  });

  it("supports inverted ranges (SVG y axis grows downward)", () => {
    const scale = scaleLinear([0, 1], [100, 0]);
    expect(scale(0)).toBe(100);
    expect(scale(1)).toBe(0);
    expect(scale(0.25)).toBe(75);
  });

  it("maps a degenerate (flat) domain to the middle of the range", () => {
    const scale = scaleLinear([3, 3], [0, 100]);
    expect(scale(3)).toBe(50);
    expect(scale(999)).toBe(50);
  });
});

describe("buildPolylinePoints", () => {
  const viewBox = { x: 0, y: 0, width: 100, height: 100 };

  it("maps samples into the view box with the y axis inverted", () => {
    const time = new Float64Array([0, 1, 2]);
    const values = new Float64Array([0, 5, 10]);
    expect(buildPolylinePoints(time, values, viewBox)).toBe("0,100 50,50 100,0");
  });

  it("handles negative values symmetrically", () => {
    const time = new Float64Array([0, 1, 2]);
    const values = new Float64Array([-10, 0, 10]);
    expect(buildPolylinePoints(time, values, viewBox)).toBe("0,100 50,50 100,0");
  });

  it("centers a flat signal vertically", () => {
    const time = new Float64Array([0, 1, 2]);
    const values = new Float64Array([2, 2, 2]);
    expect(buildPolylinePoints(time, values, viewBox)).toBe("0,50 50,50 100,50");
  });

  it("offsets by the view box origin", () => {
    const time = new Float64Array([0, 1]);
    const values = new Float64Array([0, 1]);
    const points = buildPolylinePoints(time, values, {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
    expect(points).toBe("10,70 110,20");
  });

  it("uses explicit domains when provided (shared axes across signals)", () => {
    const time = new Float64Array([0, 1]);
    const values = new Float64Array([0, 0]);
    const points = buildPolylinePoints(time, values, viewBox, [0, 1], [-10, 10]);
    expect(points).toBe("0,50 100,50");
  });

  it("truncates to the shorter of time/values and handles empty input", () => {
    const time = new Float64Array([0, 1, 2, 3]);
    const values = new Float64Array([0, 10]);
    // x extent comes from the truncated samples, so t=1 is the right edge.
    expect(buildPolylinePoints(time, values, viewBox)).toBe("0,100 100,0");
    expect(buildPolylinePoints(new Float64Array(0), new Float64Array(0), viewBox)).toBe("");
  });
});

describe("niceTicks", () => {
  it("produces round steps covering the domain", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("handles negative-to-positive domains", () => {
    expect(niceTicks(-1.2, 1.2, 5)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it("keeps every tick inside [min, max]", () => {
    const ticks = niceTicks(0.13, 0.87, 5);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(0.13);
      expect(tick).toBeLessThanOrEqual(0.87);
    }
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  it("collapses a flat domain to a single tick", () => {
    expect(niceTicks(5, 5, 5)).toEqual([5]);
  });
});

describe("formatSi", () => {
  it("formats values with engineering suffixes", () => {
    expect(formatSi(0)).toBe("0");
    expect(formatSi(0.01)).toBe("10m");
    expect(formatSi(0.0000047)).toBe("4.7µ");
    expect(formatSi(4700)).toBe("4.7k");
    expect(formatSi(-0.002)).toBe("-2m");
    expect(formatSi(2.5)).toBe("2.5");
  });
});
