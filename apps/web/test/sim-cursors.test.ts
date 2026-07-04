import { describe, expect, it } from "vitest";
import {
  autoscaleDomain,
  cursorDelta,
  cursorReadout,
  type SignalTrace,
} from "../lib/sim/cursors";

const time = new Float64Array([0, 1e-3, 2e-3, 3e-3]);
const traces: SignalTrace[] = [
  { id: "net_vin", values: new Float64Array([0, 5, 5, 0]) },
  { id: "net_vout", values: new Float64Array([0, 2, 4, 1]) },
];

describe("autoscaleDomain", () => {
  it("fits the min/max of all visible traces", () => {
    expect(autoscaleDomain(traces, [], time.length)).toEqual([0, 5]);
  });

  it("ignores hidden traces when fitting", () => {
    // Hiding net_vin (max 5) leaves net_vout, whose extent is [0, 4].
    expect(autoscaleDomain(traces, ["net_vin"], time.length)).toEqual([0, 4]);
  });

  it("falls back to [0,1] when every trace is hidden", () => {
    expect(autoscaleDomain(traces, ["net_vin", "net_vout"], time.length)).toEqual([0, 1]);
  });

  it("only scans up to the shared sample length", () => {
    const spiky: SignalTrace[] = [{ id: "a", values: new Float64Array([1, 2, 99]) }];
    // A shorter time base must not let the spike at index 2 widen the domain.
    expect(autoscaleDomain(spiky, [], 2)).toEqual([1, 2]);
  });
});

describe("cursorReadout", () => {
  it("reports (t, value) at a sample index", () => {
    expect(cursorReadout(time, traces[0]!.values, 2)).toEqual({ t: 2e-3, value: 5 });
    expect(cursorReadout(time, traces[1]!.values, 1)).toEqual({ t: 1e-3, value: 2 });
  });

  it("clamps an out-of-range index to the last sample", () => {
    expect(cursorReadout(time, traces[0]!.values, 99)).toEqual({ t: 3e-3, value: 0 });
  });
});

describe("cursorDelta", () => {
  it("reports the time and value difference between two cursors", () => {
    // net_vout: index 1 -> (1e-3, 2), index 2 -> (2e-3, 4)
    expect(cursorDelta(time, traces[1]!.values, 1, 2)).toEqual({ dt: 1e-3, dv: 2 });
  });

  it("is signed by cursor order (B minus A)", () => {
    expect(cursorDelta(time, traces[1]!.values, 2, 1)).toEqual({ dt: -1e-3, dv: -2 });
  });
});
