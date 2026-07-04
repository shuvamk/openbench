"use client";

import React, { useMemo, useState } from "react";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { buildPolylinePoints, formatSi, niceTicks, scaleLinear } from "../../lib/sim/scale";
import { autoscaleDomain, cursorDelta, cursorReadout } from "../../lib/sim/cursors";

export interface WaveformTrace {
  /** Stable id (the signal's netId). */
  id: string;
  /** Human label (net name when available). */
  label: string;
  unit: string;
  values: Float64Array;
}

export interface WaveformViewerProps {
  /** Shared time base in seconds; absent/empty means "nothing to plot". */
  time?: Float64Array;
  traces: WaveformTrace[];
  /** Controlled hidden set; when omitted the viewer keeps its own. */
  hiddenTraceIds?: string[];
  onToggleTrace?(id: string): void;
}

/**
 * Small categorical palette derived from the Astryx badge/icon colors, with
 * the net-highlight token as the guaranteed fallback (no raw hex).
 */
export const WAVEFORM_PALETTE: readonly string[] = [
  "var(--color-icon-blue, var(--ob-net-highlight))",
  "var(--color-icon-green, var(--ob-net-highlight))",
  "var(--color-icon-orange, var(--ob-net-highlight))",
  "var(--color-icon-purple, var(--ob-net-highlight))",
  "var(--color-icon-red, var(--ob-net-highlight))",
  "var(--color-icon-teal, var(--ob-net-highlight))",
  "var(--color-icon-pink, var(--ob-net-highlight))",
  "var(--color-icon-yellow, var(--ob-net-highlight))",
];

export function traceColor(index: number): string {
  return WAVEFORM_PALETTE[index % WAVEFORM_PALETTE.length]!;
}

// Internal SVG coordinate system; the svg stretches to the container.
const W = 760;
const H = 240;
const PLOT = { x: 48, y: 10, width: W - 60, height: H - 42 };
const AXIS_TEXT: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--font-family-body, sans-serif)",
  fill: "var(--ob-pin)",
};

/** SVG waveform plot: shared axes, nice ticks, legend toggles, hover readout. */
export function WaveformViewer({
  time,
  traces,
  hiddenTraceIds,
  onToggleTrace,
}: WaveformViewerProps) {
  const [internalHidden, setInternalHidden] = useState<string[]>([]);
  const hidden = hiddenTraceIds ?? internalHidden;
  const toggle = (id: string) => {
    if (onToggleTrace) onToggleTrace(id);
    if (hiddenTraceIds === undefined) {
      setInternalHidden((prev) =>
        prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id],
      );
    }
  };

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  /** Measurement cursors as sample indices; click cycles 1 → 2 → reset to 1. */
  const [cursors, setCursors] = useState<number[]>([]);

  const visible = traces.filter((trace) => !hidden.includes(trace.id));

  const domains = useMemo(() => {
    if (!time || time.length === 0) return null;
    const xDomain: [number, number] = [time[0]!, time[time.length - 1]!];
    // Autoscale: fit the min/max of the *visible* traces only.
    const yDomain = autoscaleDomain(visible, hidden, time.length);
    return { xDomain, yDomain };
    // visible identity changes with traces/hidden, which is what we want.
  }, [time, visible.map((t) => t.id).join("|"), hidden.join("|"), traces]);

  if (!time || time.length === 0 || traces.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <EmptyState
          isCompact
          title="Run a simulation"
          description="Waveforms for the probed nets will appear here."
        />
      </div>
    );
  }

  const { xDomain, yDomain } = domains!;
  const sx = scaleLinear(xDomain, [PLOT.x, PLOT.x + PLOT.width]);
  const sy = scaleLinear(yDomain, [PLOT.y + PLOT.height, PLOT.y]);
  const xTicks = niceTicks(xDomain[0], xDomain[1], 6);
  const yTicks = niceTicks(yDomain[0], yDomain[1], 4);

  const eventToIndex = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const scaled = ((fraction * W - PLOT.x) / PLOT.width) * (time.length - 1);
    return Math.max(0, Math.min(time.length - 1, Math.round(scaled)));
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    setHoverIndex(eventToIndex(event));
  };

  // Click cycles measurement cursors: place A, then B, then reset to a fresh A.
  const onClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const index = eventToIndex(event);
    setCursors((prev) => (prev.length >= 2 ? [index] : [...prev, index]));
  };

  const hoverTime = hoverIndex !== null ? time[hoverIndex] : undefined;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <svg
        data-testid="waveform-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", flex: 1, minHeight: 0, display: "block", cursor: "crosshair" }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverIndex(null)}
        onClick={onClick}
      >
        {/* Plot frame */}
        <rect
          x={PLOT.x}
          y={PLOT.y}
          width={PLOT.width}
          height={PLOT.height}
          fill="var(--ob-canvas-bg)"
          stroke="var(--ob-canvas-grid)"
        />

        {/* Y grid + labels */}
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line
              x1={PLOT.x}
              x2={PLOT.x + PLOT.width}
              y1={sy(tick)}
              y2={sy(tick)}
              stroke="var(--ob-canvas-grid)"
            />
            <text x={PLOT.x - 6} y={sy(tick) + 3} textAnchor="end" style={AXIS_TEXT}>
              {formatSi(tick)}
            </text>
          </g>
        ))}

        {/* X grid + labels (time, seconds) */}
        {xTicks.map((tick) => (
          <g key={`x${tick}`}>
            <line
              x1={sx(tick)}
              x2={sx(tick)}
              y1={PLOT.y}
              y2={PLOT.y + PLOT.height}
              stroke="var(--ob-canvas-grid)"
            />
            <text
              x={sx(tick)}
              y={PLOT.y + PLOT.height + 14}
              textAnchor="middle"
              style={AXIS_TEXT}
            >
              {formatSi(tick)}s
            </text>
          </g>
        ))}

        {/* One polyline per visible signal, shared domains. */}
        {visible.map((trace) => (
          <polyline
            key={trace.id}
            data-testid={`waveform-trace-${trace.id}`}
            points={buildPolylinePoints(time, trace.values, PLOT, xDomain, yDomain)}
            fill="none"
            stroke={traceColor(traces.findIndex((t) => t.id === trace.id))}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Hover crosshair */}
        {hoverIndex !== null && hoverTime !== undefined && (
          <line
            data-testid="waveform-crosshair"
            x1={sx(hoverTime)}
            x2={sx(hoverTime)}
            y1={PLOT.y}
            y2={PLOT.y + PLOT.height}
            stroke="var(--ob-wire-hover)"
            strokeDasharray="3 3"
          />
        )}

        {/* Measurement cursors (solid, labelled A/B). */}
        {cursors.map((index, cursorIndex) => (
          <g key={cursorIndex} data-testid={`waveform-cursor-${cursorIndex}`}>
            <line
              x1={sx(time[index]!)}
              x2={sx(time[index]!)}
              y1={PLOT.y}
              y2={PLOT.y + PLOT.height}
              stroke="var(--ob-net-highlight)"
              strokeWidth={1}
            />
            <text
              x={sx(time[index]!) + 3}
              y={PLOT.y + 10}
              style={{ ...AXIS_TEXT, fill: "var(--ob-net-highlight)" }}
            >
              {cursorIndex === 0 ? "A" : "B"}
            </text>
          </g>
        ))}
      </svg>

      {/* Legend + hover readout */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {traces.map((trace, index) => (
          <HStack key={trace.id} gap={1} vAlign="center">
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: traceColor(index),
                opacity: hidden.includes(trace.id) ? 0.3 : 1,
                display: "inline-block",
              }}
            />
            <CheckboxInput
              size="sm"
              label={`Show ${trace.label}`}
              isLabelHidden
              value={!hidden.includes(trace.id)}
              onChange={() => toggle(trace.id)}
            />
            <Text type="supporting" color="secondary">
              {trace.label}
            </Text>
          </HStack>
        ))}
        <span style={{ marginLeft: "auto" }} data-testid="waveform-readout">
          {hoverIndex !== null && hoverTime !== undefined ? (
            <Text type="supporting" color="secondary">
              {`t = ${formatSi(hoverTime)}s  ·  ${visible
                .map(
                  (trace) =>
                    `${trace.label} ${formatSi(trace.values[hoverIndex] ?? 0)}${trace.unit}`,
                )
                .join("  ·  ")}`}
            </Text>
          ) : (
            <Text type="supporting" color="secondary">
              Hover for readouts
            </Text>
          )}
        </span>
      </div>

      {/* Measurement cursor readouts + two-cursor delta. */}
      {cursors.length > 0 && (
        <div
          data-testid="waveform-cursor-readout"
          style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}
        >
          {cursors.map((index, cursorIndex) => (
            <Text key={cursorIndex} type="supporting" color="secondary">
              {`${cursorIndex === 0 ? "A" : "B"}  t = ${formatSi(
                cursorReadout(time, visible[0]?.values ?? time, index).t,
              )}s  ·  ${visible
                .map(
                  (trace) =>
                    `${trace.label} ${formatSi(cursorReadout(time, trace.values, index).value)}${
                      trace.unit
                    }`,
                )
                .join("  ·  ")}`}
            </Text>
          ))}
          {cursors.length === 2 && (
            <span key="delta" data-testid="waveform-delta-readout">
              <Text type="supporting" color="secondary">
                {`Δt = ${formatSi(
                  cursorDelta(time, time, cursors[0]!, cursors[1]!).dt,
                )}s  ·  ${visible
                  .map((trace) => {
                    const { dv } = cursorDelta(time, trace.values, cursors[0]!, cursors[1]!);
                    return `Δ${trace.label} ${formatSi(dv)}${trace.unit}`;
                  })
                  .join("  ·  ")}`}
              </Text>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
