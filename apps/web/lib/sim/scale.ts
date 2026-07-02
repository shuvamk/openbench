/**
 * Pure plotting math for the waveform viewer (issue #13). No DOM, no React —
 * everything here is unit-testable in node.
 */

export type Domain = readonly [number, number];

export interface PlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Linear domain → range mapping. A degenerate (flat) domain maps every value
 * to the middle of the range so flat signals render as a centered line
 * instead of dividing by zero.
 */
export function scaleLinear(domain: Domain, range: Domain): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d0 === d1) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  const slope = (r1 - r0) / (d1 - d0);
  return (value: number) => r0 + (value - d0) * slope;
}

function extent(values: Float64Array, length: number): Domain {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < length; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return [0, 1];
  return [min, max];
}

/** Round to a sane precision for SVG attributes (avoids 17-digit floats). */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Map (time, values) sample pairs into an SVG `<polyline points>` string.
 * The y axis is inverted (larger values sit higher on screen). Domains
 * default to the data extents; pass explicit ones to share axes across
 * several signals.
 */
export function buildPolylinePoints(
  time: Float64Array,
  values: Float64Array,
  viewBox: PlotArea,
  xDomain?: Domain,
  yDomain?: Domain,
): string {
  const length = Math.min(time.length, values.length);
  if (length === 0) return "";

  const sx = scaleLinear(xDomain ?? extent(time, length), [viewBox.x, viewBox.x + viewBox.width]);
  const sy = scaleLinear(yDomain ?? extent(values, length), [
    viewBox.y + viewBox.height,
    viewBox.y,
  ]);

  const points: string[] = new Array(length);
  for (let i = 0; i < length; i++) {
    points[i] = `${round(sx(time[i]!))},${round(sy(values[i]!))}`;
  }
  return points.join(" ");
}

/** Tick step of 1/2/5 × 10^n covering (max-min)/count (d3-style increment). */
function tickStep(min: number, max: number, count: number): number {
  const raw = (max - min) / Math.max(1, count);
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.SQRT2 ? 2 : 1;
  return factor * 10 ** power;
}

/**
 * Round tick positions inside [min, max]: 1/2/5-based steps, no tick falls
 * outside the data domain.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  if (min > max) [min, max] = [max, min];

  const step = tickStep(min, max, count);
  const start = Math.ceil(min / step) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step))) + 2;

  const ticks: number[] = [];
  for (let tick = start; tick <= max + step * 1e-9; tick += step) {
    ticks.push(Number(tick.toFixed(decimals)));
  }
  return ticks;
}

const SI_STEPS: ReadonlyArray<{ threshold: number; divisor: number; suffix: string }> = [
  { threshold: 1e9, divisor: 1e9, suffix: "G" },
  { threshold: 1e6, divisor: 1e6, suffix: "M" },
  { threshold: 1e3, divisor: 1e3, suffix: "k" },
  { threshold: 1, divisor: 1, suffix: "" },
  { threshold: 1e-3, divisor: 1e-3, suffix: "m" },
  { threshold: 1e-6, divisor: 1e-6, suffix: "µ" },
  { threshold: 1e-9, divisor: 1e-9, suffix: "n" },
  { threshold: 1e-12, divisor: 1e-12, suffix: "p" },
];

/**
 * Compact engineering formatter for axis labels and readouts:
 * 0.01 → "10m", 4700 → "4.7k", 0 → "0".
 */
export function formatSi(value: number): string {
  if (value === 0 || !Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  const step = SI_STEPS.find((s) => magnitude >= s.threshold * (1 - 1e-12)) ?? SI_STEPS[SI_STEPS.length - 1]!;
  const scaled = value / step.divisor;
  // Up to 3 significant digits, trailing zeros trimmed.
  const text = Number(scaled.toPrecision(3)).toString();
  return `${text}${step.suffix}`;
}
