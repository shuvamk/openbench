"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Component, Net, Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import {
  computeJunctions,
  getInstancePlacement,
  getPinPosition,
  getSymbolGeometry,
  orthogonalPoints,
  toPolylinePoints,
} from "../../lib/editor/geometry";
import { deriveErcIssues, instanceSeverities } from "../../lib/editor/erc";
import { clampZoom, useEditorStore, type Point } from "../../lib/editor/store";
import { useLiveStore } from "../../lib/live/store";
import { LiveOverlays, LiveSliderPopover } from "./LiveOverlays";
import { SymbolGlyph } from "./symbols";
import { ZoomControls } from "./ZoomControls";
import { traceColor } from "../sim/WaveformViewer";

/**
 * The schematic canvas: an SVG surface with a dotted grid, pan/zoom,
 * per-category symbols, orthogonal wires, pin-to-pin wiring, marquee
 * selection, and keyboard shortcuts (Esc / Del / R). Direct manipulation
 * only — every edit lands in the IR via the editor store.
 */

interface DragState {
  kind: "pan" | "move" | "marquee";
  pointerId: number;
  /** last client position (pan) */
  lastClient?: Point;
  /** move: world-space grab offset per instanceId */
  grabOffsets?: Map<string, Point>;
  /** marquee: world-space anchor */
  anchor?: Point;
  moved?: boolean;
}

/** jsdom pointer events may not carry `button`; treat missing as primary. */
function eventButton(e: React.PointerEvent): number {
  return typeof e.button === "number" && !Number.isNaN(e.button) ? e.button : 0;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function SchematicCanvas() {
  const bundle = useEditorStore((s) => s.bundle);
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const placingComponentId = useEditorStore((s) => s.placingComponentId);
  const wireDraft = useEditorStore((s) => s.wireDraft);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const spaceHeldRef = useRef(false);
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);
  const [hoveredNet, setHoveredNet] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);

  const schematic = bundle?.schematic ?? null;

  // ERC severity per instance, memoized off the schematic, so offending parts
  // get a badge on the canvas (issue #71). Empty map ⇒ nothing rendered.
  const ercSeverityByInstance = useMemo(
    () => (schematic ? instanceSeverities(deriveErcIssues(schematic)) : new Map()),
    [schematic],
  );

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      const { zoom: z, pan: p } = useEditorStore.getState();
      const x = clientX - (rect?.left ?? 0);
      const y = clientY - (rect?.top ?? 0);
      return { x: (x - p.x) / z, y: (y - p.y) / z };
    },
    [],
  );

  // Probe tool: clicking a net's wire drops a scope probe at the click point.
  const onNetClick = useCallback(
    (netId: string, e: React.MouseEvent) => {
      if (useEditorStore.getState().tool !== "probe") return;
      e.stopPropagation();
      useEditorStore.getState().addProbe(netId, clientToWorld(e.clientX, e.clientY));
    },
    [clientToWorld],
  );

  // Wheel zoom (zoom-to-cursor). Attached manually so preventDefault works.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = useEditorStore.getState();
      const rect = svg.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const nextZoom = clampZoom(state.zoom * Math.exp(-e.deltaY * 0.0015));
      const scale = nextZoom / state.zoom;
      state.setView(nextZoom, {
        x: cx - (cx - state.pan.x) * scale,
        y: cy - (cy - state.pan.y) * scale,
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard: Esc cancels, Del deletes, R rotates, Space arms panning.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const state = useEditorStore.getState();
      if (e.key === "Escape") {
        state.cancelWire();
        state.setTool("select");
        setMarquee(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        state.removeSelection();
      } else if (e.key === "r" || e.key === "R") {
        state.rotateSelection();
      } else if (e.key === " ") {
        spaceHeldRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const capturePointer = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (svg && typeof svg.setPointerCapture === "function") {
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom */
      }
    }
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    const button = eventButton(e);
    const live = useLiveStore.getState().mode === "live";
    const state = useEditorStore.getState();
    // Figma-style direct manipulation (issue 131): a left-drag on the empty
    // canvas pans by default. Middle-button and space+drag keep panning too;
    // Shift+left-drag opts into the marquee box-select. Wiring is unaffected —
    // pin/instance handlers stopPropagation before this fires.
    const wantsPan =
      button === 1 ||
      (button === 0 &&
        (spaceHeldRef.current || live || (!e.shiftKey && tool === "select")));
    if (wantsPan && !(button === 0 && e.shiftKey)) {
      e.preventDefault();
      // A left-click on empty space (no space/live pan chord, no active wire)
      // also clears the selection, matching the prior click-to-deselect feel.
      if (button === 0 && !spaceHeldRef.current && !live && !state.wireDraft) {
        state.setSelection([]);
      }
      dragRef.current = {
        kind: "pan",
        pointerId: e.pointerId,
        lastClient: { x: e.clientX, y: e.clientY },
      };
      capturePointer(e);
      return;
    }
    if (button !== 0) return;
    if (state.wireDraft) return; // clicking empty space keeps the draft alive
    if (!e.shiftKey) state.setSelection([]);
    // Shift+left-drag on empty space box-selects (marquee).
    if (tool === "select" && e.shiftKey) {
      const anchor = clientToWorld(e.clientX, e.clientY);
      dragRef.current = { kind: "marquee", pointerId: e.pointerId, anchor };
      capturePointer(e);
    }
  };

  const onInstancePointerDown = (instanceId: string) => (e: React.PointerEvent) => {
    if (useLiveStore.getState().mode === "live") return; // live overlays own interaction
    if (eventButton(e) !== 0 || spaceHeldRef.current) return;
    e.stopPropagation();
    const state = useEditorStore.getState();
    if (state.wireDraft) return;
    if (e.shiftKey) {
      state.addToSelection(instanceId);
      return;
    }
    if (!state.selection.includes(instanceId)) state.setSelection([instanceId]);
    if (!schematic) return;
    const world = clientToWorld(e.clientX, e.clientY);
    const grabOffsets = new Map<string, Point>();
    for (const id of useEditorStore.getState().selection) {
      const placement = getInstancePlacement(schematic, id);
      grabOffsets.set(id, { x: placement.x - world.x, y: placement.y - world.y });
    }
    state.beginGesture();
    dragRef.current = { kind: "move", pointerId: e.pointerId, grabOffsets };
    capturePointer(e);
  };

  const onPinPointerDown = (instanceId: string, pinId: string) => (e: React.PointerEvent) => {
    if (useLiveStore.getState().mode === "live") return;
    if (eventButton(e) !== 0) return;
    e.stopPropagation();
    const state = useEditorStore.getState();
    if (state.wireDraft) {
      state.connect(state.wireDraft.from, { instanceId, pinId });
    } else {
      state.startWire({ instanceId, pinId });
      state.moveWireCursor(clientToWorld(e.clientX, e.clientY));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const state = useEditorStore.getState();
    if (state.wireDraft) state.moveWireCursor(clientToWorld(e.clientX, e.clientY));

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.kind === "pan" && drag.lastClient) {
      const dx = e.clientX - drag.lastClient.x;
      const dy = e.clientY - drag.lastClient.y;
      drag.lastClient = { x: e.clientX, y: e.clientY };
      state.setPan({ x: state.pan.x + dx, y: state.pan.y + dy });
    } else if (drag.kind === "move" && drag.grabOffsets) {
      const world = clientToWorld(e.clientX, e.clientY);
      drag.moved = true;
      for (const [id, offset] of drag.grabOffsets) {
        state.move(id, { x: world.x + offset.x, y: world.y + offset.y });
      }
    } else if (drag.kind === "marquee" && drag.anchor) {
      setMarquee({ a: drag.anchor, b: clientToWorld(e.clientX, e.clientY) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (drag.kind === "move") useEditorStore.getState().endGesture();
    if (drag.kind === "marquee" && marquee && schematic) {
      const minX = Math.min(marquee.a.x, marquee.b.x);
      const maxX = Math.max(marquee.a.x, marquee.b.x);
      const minY = Math.min(marquee.a.y, marquee.b.y);
      const maxY = Math.max(marquee.a.y, marquee.b.y);
      if (maxX - minX > 2 || maxY - minY > 2) {
        const hit = schematic.instances
          .filter((instance) => {
            const placement = getInstancePlacement(schematic, instance.instanceId);
            return (
              placement.x >= minX && placement.x <= maxX && placement.y >= minY && placement.y <= maxY
            );
          })
          .map((instance) => instance.instanceId);
        useEditorStore.getState().setSelection(hit);
      }
    }
    setMarquee(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (useLiveStore.getState().mode === "live") return;
    const state = useEditorStore.getState();
    if (state.tool !== "place" || !state.placingComponentId) return;
    const component = getComponent(state.placingComponentId);
    if (!component) return;
    state.place(component, clientToWorld(e.clientX, e.clientY));
  };

  const selectedNetIds = new Set<string>();
  if (schematic) {
    for (const net of schematic.nets) {
      if (net.connections.some((c) => selection.includes(c.instanceId))) {
        selectedNetIds.add(net.netId);
      }
    }
  }

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        background: "var(--ob-canvas-bg)",
        cursor: tool === "place" ? "crosshair" : "default",
      }}
    >
      <svg
        ref={svgRef}
        data-testid="schematic-canvas"
        role="application"
        aria-label="Schematic canvas"
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <pattern
            id="ob-grid-dots"
            width={10 * zoom}
            height={10 * zoom}
            patternUnits="userSpaceOnUse"
            x={pan.x % (10 * zoom)}
            y={pan.y % (10 * zoom)}
          >
            <circle cx={1} cy={1} r={Math.max(0.6, zoom * 0.8)} fill="var(--ob-canvas-grid)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ob-grid-dots)" pointerEvents="none" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {schematic && (
            <WireLayer
              schematic={schematic}
              selectedNetIds={selectedNetIds}
              hoveredNet={hoveredNet}
              onHoverNet={setHoveredNet}
              probeArmed={tool === "probe"}
              onNetClick={onNetClick}
            />
          )}

          {schematic && wireDraft && (
            <DraftWire schematic={schematic} draft={wireDraft} />
          )}

          {schematic && <ProbeMarkers schematic={schematic} />}

          {schematic?.instances.map((instance) => {
            const component = getComponent(instance.componentId);
            if (!component) return null;
            const placement = getInstancePlacement(schematic, instance.instanceId);
            const geometry = getSymbolGeometry(component);
            const selected = selection.includes(instance.instanceId);
            const ercSeverity = ercSeverityByInstance.get(instance.instanceId);
            return (
              <g
                key={instance.instanceId}
                data-instance-id={instance.instanceId}
                transform={`translate(${placement.x}, ${placement.y}) rotate(${placement.rotation})`}
                onPointerDown={onInstancePointerDown(instance.instanceId)}
                style={{ cursor: "grab" }}
              >
                {selected && (
                  <rect
                    x={-geometry.halfWidth - 6}
                    y={-geometry.halfHeight - 6}
                    width={geometry.halfWidth * 2 + 12}
                    height={geometry.halfHeight * 2 + 12}
                    rx={4}
                    fill="var(--ob-selection)"
                    stroke="var(--ob-net-highlight)"
                    strokeWidth={1}
                    data-selection-outline={instance.instanceId}
                  />
                )}
                <SymbolGlyph component={component} />
                <text
                  x={0}
                  y={-geometry.halfHeight - 10}
                  fontSize={10}
                  textAnchor="middle"
                  fill="var(--ob-pin)"
                  pointerEvents="none"
                >
                  {instance.instanceId}
                </text>
                {ercSeverity && (
                  <ErcBadge
                    x={geometry.halfWidth + 5}
                    y={-geometry.halfHeight - 5}
                    severity={ercSeverity}
                    instanceId={instance.instanceId}
                  />
                )}
                {component.pins.map((pin) => {
                  const offset = geometry.pins[pin.id];
                  if (!offset) return null;
                  const key = `${instance.instanceId}:${pin.id}`;
                  const hovered = hoveredPin === key;
                  return (
                    <g key={pin.id}>
                      {hovered && (
                        <circle
                          cx={offset.x}
                          cy={offset.y}
                          r={8}
                          fill="var(--ob-selection)"
                          pointerEvents="none"
                        />
                      )}
                      <circle
                        data-pin={key}
                        cx={offset.x}
                        cy={offset.y}
                        r={hovered ? 4.5 : 3}
                        fill="var(--ob-pin)"
                        style={{ cursor: "crosshair" }}
                        onPointerDown={onPinPointerDown(instance.instanceId, pin.id)}
                        onPointerEnter={() => setHoveredPin(key)}
                        onPointerLeave={() => setHoveredPin(null)}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          <LiveModeOverlaySlot />

          {marquee && (
            <rect
              data-marquee
              x={Math.min(marquee.a.x, marquee.b.x)}
              y={Math.min(marquee.a.y, marquee.b.y)}
              width={Math.abs(marquee.b.x - marquee.a.x)}
              height={Math.abs(marquee.b.y - marquee.a.y)}
              fill="var(--ob-selection)"
              stroke="var(--ob-net-highlight)"
              strokeWidth={1}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
      {tool === "place" && placingComponentId && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "4px 12px",
            borderRadius: 999,
            background: "var(--ob-symbol-body)",
            border: "1px solid var(--ob-canvas-grid)",
            fontSize: 12,
            color: "var(--ob-pin)",
            pointerEvents: "none",
          }}
        >
          Double-click to place {getComponent(placingComponentId)?.name ?? "component"} — Esc to cancel
        </div>
      )}
      <LiveSliderSlot />
      <ZoomControls
        getViewport={() => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect || rect.width === 0 || rect.height === 0) return null;
          return { width: rect.width, height: rect.height };
        }}
      />
    </div>
  );
}

/** Overlays only mount in live mode, keeping design-mode renders untouched. */
function LiveModeOverlaySlot() {
  const mode = useLiveStore((s) => s.mode);
  if (mode !== "live") return null;
  return <LiveOverlays />;
}

function LiveSliderSlot() {
  const mode = useLiveStore((s) => s.mode);
  if (mode !== "live") return null;
  return <LiveSliderPopover />;
}

/**
 * A small severity badge pinned to an instance's top-right corner when ERC
 * flags it (issue #71). Non-interactive so it never steals the grab gesture;
 * colored from theme feedback tokens.
 */
function ErcBadge({
  x,
  y,
  severity,
  instanceId,
}: {
  x: number;
  y: number;
  severity: "error" | "warning";
  instanceId: string;
}) {
  const color = severity === "error" ? "var(--ob-erc-error)" : "var(--ob-erc-warning)";
  return (
    <g
      data-erc-badge={instanceId}
      data-erc-severity={severity}
      transform={`translate(${x}, ${y})`}
      pointerEvents="none"
    >
      <circle r={6} fill={color} />
      <text
        x={0}
        y={0.5}
        fontSize={9}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--ob-symbol-body)"
      >
        !
      </text>
    </g>
  );
}

function netWireSegments(schematic: Schematic, net: Net): Point[][] {
  const positions: Point[] = [];
  for (const connection of net.connections) {
    const instance = schematic.instances.find((i) => i.instanceId === connection.instanceId);
    const component: Component | undefined = instance
      ? getComponent(instance.componentId)
      : undefined;
    if (!instance || !component) continue;
    positions.push(getPinPosition(schematic, component, instance.instanceId, connection.pinId));
  }
  const [first, ...rest] = positions;
  if (!first) return [];
  return rest.map((target) => orthogonalPoints(first, target));
}

function WireLayer({
  schematic,
  selectedNetIds,
  hoveredNet,
  onHoverNet,
  probeArmed,
  onNetClick,
}: {
  schematic: Schematic;
  selectedNetIds: Set<string>;
  hoveredNet: string | null;
  onHoverNet: (netId: string | null) => void;
  probeArmed: boolean;
  onNetClick: (netId: string, e: React.MouseEvent) => void;
}) {
  return (
    <g>
      {schematic.nets.map((net) => {
        const highlighted = selectedNetIds.has(net.netId);
        const hovered = hoveredNet === net.netId;
        const stroke = highlighted
          ? "var(--ob-net-highlight)"
          : hovered
            ? "var(--ob-wire-hover)"
            : "var(--ob-wire)";
        const segments = netWireSegments(schematic, net);
        const active = highlighted || hovered;
        return (
          <g key={net.netId} data-net-id={net.netId}>
            {segments.map((points, index) => (
              <polyline
                key={index}
                points={toPolylinePoints(points)}
                fill="none"
                stroke={stroke}
                strokeWidth={active ? 2.5 : 1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={probeArmed ? { cursor: "crosshair" } : undefined}
                onPointerEnter={() => onHoverNet(net.netId)}
                onPointerLeave={() => onHoverNet(null)}
                onClick={(e) => onNetClick(net.netId, e)}
              />
            ))}
            {computeJunctions(segments).map((point, index) => (
              // Filled connectivity dot where >=3 wire ends of this net meet.
              // Radius is in world units so it tracks the wire stroke as the
              // canvas zooms; it uses the net's active-highlight color to match
              // wire styling on select/hover.
              <circle
                key={`j${index}`}
                data-junction-dot
                cx={point.x}
                cy={point.y}
                r={active ? 4 : 3}
                fill={stroke}
                pointerEvents="none"
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Scope-probe markers (issue #37): a colored dot per probe at its stored
 * `layout` position, labelled with the net name. Clicking a marker removes it.
 */
function ProbeMarkers({ schematic }: { schematic: Schematic }) {
  const probes = schematic.layout?.probes ?? [];
  if (probes.length === 0) return null;
  const nameByNetId = new Map(schematic.nets.map((net) => [net.netId, net.name ?? net.netId]));
  return (
    <g>
      {probes.map((probe, index) => {
        const color = probe.color ?? traceColor(index);
        return (
          <g
            key={probe.probeId}
            data-probe-id={probe.probeId}
            transform={`translate(${probe.x}, ${probe.y})`}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              useEditorStore.getState().removeProbe(probe.probeId);
            }}
          >
            <circle r={5} fill={color} stroke="var(--ob-canvas-bg)" strokeWidth={1.5} />
            <circle r={9} fill="none" stroke={color} strokeWidth={1} opacity={0.6} />
            <text
              x={11}
              y={4}
              style={{
                fontSize: 10,
                fontFamily: "var(--font-family-body, sans-serif)",
                fill: color,
              }}
            >
              {nameByNetId.get(probe.netId) ?? probe.netId}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DraftWire({
  schematic,
  draft,
}: {
  schematic: Schematic;
  draft: { from: { instanceId: string; pinId: string }; cursor: Point };
}) {
  const instance = schematic.instances.find((i) => i.instanceId === draft.from.instanceId);
  const component = instance ? getComponent(instance.componentId) : undefined;
  if (!instance || !component) return null;
  const start = getPinPosition(schematic, component, instance.instanceId, draft.from.pinId);
  return (
    <polyline
      data-wire-draft
      points={toPolylinePoints(orthogonalPoints(start, draft.cursor))}
      fill="none"
      stroke="var(--ob-wire-hover)"
      strokeWidth={1.5}
      strokeDasharray="5 4"
      pointerEvents="none"
    />
  );
}
