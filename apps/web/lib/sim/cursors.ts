/**
 * Pure cursor + autoscale math for the waveform viewer v2 (issue #37). No DOM,
 * no React — everything here is unit-testable in node, mirroring lib/sim/scale.
 */

export interface SignalTrace {
  id: string;
  values: Float64Array;
}

/** Clamp a (possibly out-of-range) sample index into [0, length-1]. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, Math.round(index)));
}

/**
 * Y-domain [min, max] fitting only the *visible* traces (autoscale), scanning
 * at most `sampleLength` samples so a trace longer than the shared time base
 * can't widen the axis. Falls back to [0, 1] when nothing is visible.
 */
export function autoscaleDomain(
  traces: readonly SignalTrace[],
  hiddenIds: readonly string[],
  sampleLength: number,
): [number, number] {
  const hidden = new Set(hiddenIds);
  let min = Infinity;
  let max = -Infinity;
  for (const trace of traces) {
    if (hidden.has(trace.id)) continue;
    const length = Math.min(trace.values.length, sampleLength);
    for (let i = 0; i < length; i++) {
      const v = trace.values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return [0, 1];
  return [min, max];
}

/** The (t, value) readout for one trace at a sample index (index clamped). */
export function cursorReadout(
  time: Float64Array,
  values: Float64Array,
  index: number,
): { t: number; value: number } {
  const i = clampIndex(index, time.length);
  return { t: time[i] ?? 0, value: values[i] ?? 0 };
}

/**
 * Signed delta between two cursors A→B for one trace: `dt = t(B) - t(A)`,
 * `dv = v(B) - v(A)`. Both indices are clamped to the time base.
 */
export function cursorDelta(
  time: Float64Array,
  values: Float64Array,
  indexA: number,
  indexB: number,
): { dt: number; dv: number } {
  const a = cursorReadout(time, values, indexA);
  const b = cursorReadout(time, values, indexB);
  return { dt: b.t - a.t, dv: b.value - a.value };
}
