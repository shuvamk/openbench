"use client";

import React from "react";
import type { Component } from "@openbench/ir-schema";
import { getSymbolGeometry, getSymbolKind } from "../../lib/editor/geometry";

/**
 * Schematic symbol glyphs, drawn centered at the origin with plain SVG
 * primitives. Rotation/translation is applied by the parent <g> in the
 * canvas, so every glyph only worries about its own local shape.
 */

const STROKE = "var(--ob-symbol-stroke)";
const BODY = "var(--ob-symbol-body)";

const strokeProps = {
  stroke: STROKE,
  strokeWidth: 1.5,
  fill: "none",
  strokeLinecap: "round" as const,
};

function ResistorGlyph() {
  return (
    <g>
      <line x1={-30} y1={0} x2={-20} y2={0} {...strokeProps} />
      <line x1={20} y1={0} x2={30} y2={0} {...strokeProps} />
      <rect x={-20} y={-7} width={40} height={14} fill={BODY} stroke={STROKE} strokeWidth={1.5} />
    </g>
  );
}

function CapacitorGlyph() {
  return (
    <g>
      <line x1={-20} y1={0} x2={-4} y2={0} {...strokeProps} />
      <line x1={4} y1={0} x2={20} y2={0} {...strokeProps} />
      <line x1={-4} y1={-12} x2={-4} y2={12} {...strokeProps} strokeWidth={2} />
      <line x1={4} y1={-12} x2={4} y2={12} {...strokeProps} strokeWidth={2} />
    </g>
  );
}

function LedGlyph() {
  return (
    <g>
      <line x1={-20} y1={0} x2={-8} y2={0} {...strokeProps} />
      <line x1={8} y1={0} x2={20} y2={0} {...strokeProps} />
      <polygon
        points="-8,-9 -8,9 8,0"
        fill={BODY}
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <line x1={8} y1={-9} x2={8} y2={9} {...strokeProps} strokeWidth={2} />
      {/* emission arrows */}
      <line x1={0} y1={-8} x2={6} y2={-14} {...strokeProps} strokeWidth={1} />
      <polyline points="3,-14 6,-14 6,-11" {...strokeProps} strokeWidth={1} strokeLinejoin="round" />
      <line x1={5} y1={-5} x2={11} y2={-11} {...strokeProps} strokeWidth={1} />
      <polyline points="8,-11 11,-11 11,-8" {...strokeProps} strokeWidth={1} strokeLinejoin="round" />
    </g>
  );
}

function VsourceGlyph() {
  return (
    <g>
      <line x1={0} y1={-30} x2={0} y2={-4} {...strokeProps} />
      <line x1={0} y1={4} x2={0} y2={30} {...strokeProps} />
      {/* long (+) and short (-) battery plates */}
      <line x1={-16} y1={-4} x2={16} y2={-4} {...strokeProps} strokeWidth={1.5} />
      <line x1={-8} y1={4} x2={8} y2={4} {...strokeProps} strokeWidth={3} />
      <text x={12} y={-12} fontSize={10} fill={STROKE} textAnchor="middle">
        +
      </text>
      <text x={12} y={18} fontSize={10} fill={STROKE} textAnchor="middle">
        −
      </text>
    </g>
  );
}

function GroundGlyph() {
  return (
    <g>
      <line x1={0} y1={-12} x2={0} y2={0} {...strokeProps} />
      <line x1={-14} y1={0} x2={14} y2={0} {...strokeProps} />
      <line x1={-9} y1={5} x2={9} y2={5} {...strokeProps} />
      <line x1={-4} y1={10} x2={4} y2={10} {...strokeProps} />
    </g>
  );
}

function McuGlyph({ component }: { component: Component }) {
  const geometry = getSymbolGeometry(component);
  const bodyHalfWidth = geometry.halfWidth - 12;
  const bodyHalfHeight = geometry.halfHeight - 8;
  return (
    <g>
      <rect
        x={-bodyHalfWidth}
        y={-bodyHalfHeight}
        width={bodyHalfWidth * 2}
        height={bodyHalfHeight * 2}
        rx={4}
        fill={BODY}
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {component.pins.map((pin) => {
        const offset = geometry.pins[pin.id];
        if (!offset) return null;
        const left = offset.x < 0;
        return (
          <g key={pin.id}>
            <line
              x1={left ? -bodyHalfWidth : bodyHalfWidth}
              y1={offset.y}
              x2={offset.x}
              y2={offset.y}
              {...strokeProps}
            />
            <text
              x={left ? -bodyHalfWidth + 4 : bodyHalfWidth - 4}
              y={offset.y + 3}
              fontSize={8}
              fill={STROKE}
              textAnchor={left ? "start" : "end"}
            >
              {pin.name}
            </text>
          </g>
        );
      })}
      <text x={0} y={3} fontSize={9} fill={STROKE} textAnchor="middle" fontWeight={600}>
        {component.name}
      </text>
    </g>
  );
}

export function SymbolGlyph({ component }: { component: Component }) {
  switch (getSymbolKind(component)) {
    case "resistor":
      return <ResistorGlyph />;
    case "capacitor":
      return <CapacitorGlyph />;
    case "led":
      return <LedGlyph />;
    case "vsource":
      return <VsourceGlyph />;
    case "ground":
      return <GroundGlyph />;
    default:
      return <McuGlyph component={component} />;
  }
}

/** Small stand-alone preview of a symbol (used by the palette). */
export function SymbolPreview({ component }: { component: Component }) {
  const geometry = getSymbolGeometry(component);
  const pad = 8;
  const width = geometry.halfWidth * 2 + pad * 2;
  const height = geometry.halfHeight * 2 + pad * 2;
  const scale = Math.min(48 / width, 36 / height, 1);
  return (
    <svg
      width={Math.ceil(width * scale)}
      height={Math.ceil(height * scale)}
      viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <SymbolGlyph component={component} />
    </svg>
  );
}
