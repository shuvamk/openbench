"use client";

import React, { useEffect, useMemo } from "react";
import type { Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { getInstancePlacement, getSymbolGeometry } from "../../lib/editor/geometry";
import { useEditorStore } from "../../lib/editor/store";
import { latestRun, useLiveStore } from "../../lib/live/store";
import { deriveInstanceStates, sampleAt, type InstanceTimeline } from "../../lib/live/derive";

/**
 * Live-mode overlays (issue #25), rendered inside the canvas' world-space
 * <g>: LED/RGB glow halos, motor rotor spin, buzzer ripples, lamp glow, and
 * the interaction surfaces for pushbuttons/switches/pots/LDRs. Everything is
 * a deterministic function of `liveTime`, so scrubbing replays identically.
 */

const HIGHLIGHT = "var(--ob-net-highlight)";
/** Visual rotor speed at rpmFraction = 1 (revolutions per played second). */
const MAX_VISUAL_RPS = 2.5;

/** LED-ish warm glow color; lamp uses the same. Halo only — symbols stay tokened. */
const GLOW = "var(--ob-net-highlight)";
// The RGB LED's three channels are inherently literal colors — the one
// justified exception to the no-raw-color rule (they represent red/green/blue
// light itself, not themeable UI chrome).
const RGB_CHANNELS: Array<{ key: "brightness_r" | "brightness_g" | "brightness_b"; color: string; dy: number }> = [
  { key: "brightness_r", color: "rgb(255,64,64)", dy: -12 },
  { key: "brightness_g", color: "rgb(64,220,64)", dy: 0 },
  { key: "brightness_b", color: "rgb(64,128,255)", dy: 12 },
];

interface OverlayProps {
  instanceId: string;
  schematic: Schematic;
  timeline: InstanceTimeline;
  time: Float64Array;
  liveTime: number;
}

function GlowHalo({ radius, opacity, color }: { radius: number; opacity: number; color: string }) {
  if (opacity <= 0.02) return null;
  return (
    <circle cx={0} cy={0} r={radius} fill={color} opacity={Math.min(opacity, 1) * 0.85} filter="url(#ob-live-glow)" pointerEvents="none" />
  );
}

function InstanceOverlay({ instanceId, schematic, timeline, time, liveTime }: OverlayProps) {
  const interact = useLiveStore((s) => s.interact);
  const setSliderFor = useLiveStore((s) => s.setSliderFor);
  const instance = schematic.instances.find((i) => i.instanceId === instanceId);
  const component = instance ? getComponent(instance.componentId) : undefined;
  if (!instance || !component) return null;
  const placement = getInstancePlacement(schematic, instanceId);
  const geometry = getSymbolGeometry(component);
  const at = (name: string) => {
    const series = timeline.series[name];
    return series ? sampleAt(time, series, liveTime) : 0;
  };

  const hit = (
    onDown?: (e: React.PointerEvent) => void,
    onUp?: (e: React.PointerEvent) => void,
    onClick?: () => void,
  ) => (
    <rect
      x={-geometry.halfWidth - 6}
      y={-geometry.halfHeight - 6}
      width={geometry.halfWidth * 2 + 12}
      height={geometry.halfHeight * 2 + 12}
      fill="transparent"
      style={{ cursor: "pointer" }}
      data-live-hit={instanceId}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onClick={onClick}
    />
  );

  let visual: React.ReactNode = null;
  let interaction: React.ReactNode = null;

  switch (timeline.kind) {
    case "led": {
      visual = <GlowHalo radius={16} opacity={at("brightness")} color={GLOW} />;
      break;
    }
    case "rgb": {
      visual = (
        <g>
          {RGB_CHANNELS.map(({ key, color, dy }) => {
            const brightness = at(key);
            return brightness > 0.02 ? (
              <circle key={key} cx={0} cy={dy} r={10} fill={color} opacity={Math.min(brightness, 1) * 0.85} filter="url(#ob-live-glow)" pointerEvents="none" />
            ) : null;
          })}
        </g>
      );
      break;
    }
    case "motor": {
      const rpm = at("rpmFraction");
      const angle = (liveTime * rpm * MAX_VISUAL_RPS * 360) % 360;
      visual = (
        <g pointerEvents="none">
          {rpm > 0.01 && (
            <g transform={`rotate(${angle})`} data-live-rotor={instanceId}>
              <line x1={0} y1={-9} x2={0} y2={9} stroke={HIGHLIGHT} strokeWidth={2} strokeLinecap="round" />
              <line x1={-9} y1={0} x2={9} y2={0} stroke={HIGHLIGHT} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
            </g>
          )}
        </g>
      );
      break;
    }
    case "buzzer": {
      const on = at("on") > 0.5;
      const phase = (liveTime * 2) % 1;
      visual = on ? (
        <g pointerEvents="none" data-live-ripple={instanceId}>
          <circle cx={0} cy={0} r={14 + phase * 10} fill="none" stroke={HIGHLIGHT} strokeWidth={1.5} opacity={1 - phase} />
          <circle cx={0} cy={0} r={14 + ((phase + 0.5) % 1) * 10} fill="none" stroke={HIGHLIGHT} strokeWidth={1.5} opacity={1 - ((phase + 0.5) % 1)} />
        </g>
      ) : null;
      break;
    }
    case "lamp": {
      visual = <GlowHalo radius={18} opacity={at("intensity")} color={GLOW} />;
      break;
    }
    default:
      break;
  }

  switch (component.id) {
    case "cmp_pushbutton":
      interaction = hit(
        (e) => {
          e.stopPropagation();
          interact(instanceId, "pressed", 1);
        },
        (e) => {
          e.stopPropagation();
          const pressed = (instance.parameterOverrides?.pressed as number | undefined) ?? 0;
          if (pressed === 1) interact(instanceId, "pressed", 0);
        },
      );
      break;
    case "cmp_switch_spst":
      interaction = hit(undefined, undefined, () => {
        const closed = (instance.parameterOverrides?.closed as number | undefined) ?? 0;
        interact(instanceId, "closed", closed === 1 ? 0 : 1);
      });
      break;
    case "cmp_potentiometer":
    case "cmp_ldr":
      interaction = hit(undefined, undefined, () => setSliderFor(instanceId));
      break;
    default:
      break;
  }

  return (
    <g transform={`translate(${placement.x}, ${placement.y})`}>
      {visual}
      {interaction}
    </g>
  );
}

/** All live overlays; render inside the canvas world <g> when mode === "live". */
export function LiveOverlays() {
  const bundle = useEditorStore((s) => s.bundle);
  const liveTime = useLiveStore((s) => s.liveTime);
  const simulating = useLiveStore((s) => s.simulating);

  const run = latestRun(bundle);
  const derived = useMemo(() => {
    if (!bundle || !run) return null;
    const result = deriveInstanceStates(bundle.schematic, getComponent, run);
    return result.ok ? result : null;
  }, [bundle, run]);

  if (!bundle || !derived) return null;

  return (
    <g data-live-overlays opacity={simulating ? 0.55 : 1}>
      <defs>
        <filter id="ob-live-glow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation={5} />
        </filter>
      </defs>
      {[...derived.states.entries()].map(([instanceId, timeline]) => (
        <InstanceOverlay
          key={instanceId}
          instanceId={instanceId}
          schematic={bundle.schematic}
          timeline={timeline}
          time={derived.time}
          liveTime={liveTime}
        />
      ))}
    </g>
  );
}

/**
 * Floating slider for pots/LDRs, positioned by the canvas (screen space).
 * Native range input: bespoke canvas chrome sized for direct manipulation —
 * themed via the accent token rather than an Astryx form control so it can
 * live inside the tight popover.
 */
export function LiveSliderPopover() {
  const bundle = useEditorStore((s) => s.bundle);
  const sliderFor = useLiveStore((s) => s.sliderFor);
  const setSliderFor = useLiveStore((s) => s.setSliderFor);
  const interact = useLiveStore((s) => s.interact);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);

  useEffect(() => {
    if (!sliderFor) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSliderFor(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [sliderFor, setSliderFor]);

  if (!bundle || !sliderFor) return null;
  const instance = bundle.schematic.instances.find((i) => i.instanceId === sliderFor);
  const component = instance ? getComponent(instance.componentId) : undefined;
  if (!instance || !component) return null;

  const parameterName = component.id === "cmp_potentiometer" ? "position" : "lux";
  const value =
    (instance.parameterOverrides?.[parameterName] as number | undefined) ??
    (component.parameters.find((p) => p.name === parameterName)?.default as number | undefined) ??
    0.5;
  const placement = getInstancePlacement(bundle.schematic, sliderFor);
  const left = placement.x * zoom + pan.x;
  const top = (placement.y + getSymbolGeometry(component).halfHeight + 14) * zoom + pan.y;

  return (
    <div
      data-live-slider={sliderFor}
      style={{
        position: "absolute",
        left,
        top,
        transform: "translateX(-50%)",
        background: "var(--ob-symbol-body)",
        border: "1px solid var(--ob-canvas-grid)",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
        display: "flex",
        gap: 8,
        alignItems: "center",
        zIndex: 10,
      }}
    >
      <span style={{ font: "11px/1 var(--xds-font-family-base, sans-serif)", color: "var(--ob-pin)" }}>
        {sliderFor} · {parameterName}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        defaultValue={value}
        style={{ accentColor: "var(--ob-net-highlight)", width: 120 }}
        onChange={(e) => interact(sliderFor, parameterName, Number(e.target.value))}
        aria-label={`${sliderFor} ${parameterName}`}
      />
      <button
        type="button"
        onClick={() => setSliderFor(null)}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--ob-pin)",
          cursor: "pointer",
          fontSize: 12,
        }}
        aria-label="Close"
      >
        ✕
      </button>
    </div>
  );
}
