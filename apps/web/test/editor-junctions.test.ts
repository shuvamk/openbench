import { describe, expect, it } from "vitest";
import { computeJunctions, type Point } from "../lib/editor/geometry";

/**
 * Junction dots (issue #129): a filled dot belongs at any coordinate where
 * three or more wire endpoints of the SAME net coincide. Two coinciding
 * endpoints (a routed corner / 2-pin net) or a mere crossover between two
 * different nets must NOT produce a dot.
 *
 * `computeJunctions` is a pure helper over a single net's wire segments
 * (each segment is an orthogonal polyline: an array of >=2 points). It counts
 * the endpoints (first + last point) of every segment and returns a junction
 * point wherever >=3 endpoints land on the same coordinate.
 */
describe("computeJunctions", () => {
  it("returns nothing for a 2-pin net (single segment, two distinct endpoints)", () => {
    const segments: Point[][] = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    ];
    expect(computeJunctions(segments)).toEqual([]);
  });

  it("does not dot a routed corner where exactly two endpoints coincide", () => {
    // Two segments meeting end-to-end at (10,0): that shared point has exactly
    // two coincident endpoints, so it is a corner, not a junction.
    const segments: Point[][] = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    ];
    expect(computeJunctions(segments)).toEqual([]);
  });

  it("produces exactly one junction at a 3-way tee", () => {
    // Star routing from a common pin at (0,0) out to three pins. The common
    // point is an endpoint of all three segments -> one junction.
    const tee: Point = { x: 0, y: 0 };
    const segments: Point[][] = [
      [tee, { x: 20, y: 0 }],
      [tee, { x: 0, y: 20 }],
      [tee, { x: -20, y: 0 }],
    ];
    const junctions = computeJunctions(segments);
    expect(junctions).toHaveLength(1);
    expect(junctions[0]).toEqual(tee);
  });

  it("counts intermediate bend vertices as non-endpoints (no false junction)", () => {
    // Three segments that happen to route their MIDDLE bend through a shared
    // coordinate must not create a junction there; only endpoints count.
    const shared: Point = { x: 5, y: 5 };
    const segments: Point[][] = [
      [{ x: 0, y: 5 }, shared, { x: 10, y: 10 }],
      [{ x: 5, y: 0 }, shared, { x: 10, y: 12 }],
      [{ x: 1, y: 5 }, shared, { x: 10, y: 14 }],
    ];
    expect(computeJunctions(segments)).toEqual([]);
  });
});

/**
 * Cross-net independence: `computeJunctions` operates on ONE net's segments,
 * so two different nets crossing at a non-endpoint coordinate can never share
 * a junction. This test documents that invariant at the call boundary.
 */
describe("computeJunctions is per-net", () => {
  it("crossing segments of different nets produce no shared junction", () => {
    const netA: Point[][] = [
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
    ];
    const netB: Point[][] = [
      [
        { x: 0, y: -10 },
        { x: 0, y: 10 },
      ],
    ];
    // They geometrically cross at (0,0) but that point is an endpoint of
    // neither net's segment, and the nets are evaluated independently.
    expect(computeJunctions(netA)).toEqual([]);
    expect(computeJunctions(netB)).toEqual([]);
  });
});
