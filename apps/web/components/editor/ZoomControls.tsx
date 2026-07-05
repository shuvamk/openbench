"use client";

import React, { useCallback } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import {
  fitToContent,
  getSymbolGeometry,
  type ComponentBounds,
  type Viewport,
} from "../../lib/editor/geometry";
import { getComponent } from "@openbench/registry";
import { useEditorStore } from "../../lib/editor/store";

/** Fixed multiplicative step for the +/- buttons (matches the top-bar zoom). */
const ZOOM_STEP = 1.25;
/** Fallback viewport used when the live canvas size can't be measured (SSR/tests). */
const DEFAULT_VIEWPORT: Viewport = { width: 800, height: 600 };

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** World-space bounds of every placed instance, for zoom-to-fit framing. */
function schematicBounds(): ComponentBounds[] {
  const bundle = useEditorStore.getState().bundle;
  const schematic = bundle?.schematic;
  if (!schematic) return [];
  const bounds: ComponentBounds[] = [];
  for (const instance of schematic.instances) {
    const component = getComponent(instance.componentId);
    if (!component) continue;
    const placement = schematic.layout?.instances[instance.instanceId];
    const geometry = getSymbolGeometry(component);
    bounds.push({
      x: placement?.x ?? 0,
      y: placement?.y ?? 0,
      halfWidth: geometry.halfWidth,
      halfHeight: geometry.halfHeight,
    });
  }
  return bounds;
}

export interface ZoomControlsProps {
  /** Resolves the current canvas viewport size; defaults to a fixed frame. */
  getViewport?: () => Viewport | null;
}

/**
 * On-canvas zoom controls (issue 131): +/- stepping, a percentage readout that
 * resets to 100% on click, and a zoom-to-fit button that frames all placed
 * components. Built on Astryx primitives so it inherits theme tokens.
 */
export function ZoomControls({ getViewport }: ZoomControlsProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const percent = Math.round(zoom * 100);

  const stepZoom = useCallback((factor: number) => {
    const state = useEditorStore.getState();
    state.setZoom(state.zoom * factor);
  }, []);

  const resetZoom = useCallback(() => {
    useEditorStore.getState().setZoom(1);
  }, []);

  const fit = useCallback(() => {
    const viewport = getViewport?.() ?? DEFAULT_VIEWPORT;
    const view = fitToContent(schematicBounds(), viewport);
    useEditorStore.getState().setView(view.zoom, view.pan);
  }, [getViewport]);

  return (
    <div
      data-testid="zoom-controls"
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        zIndex: 2,
      }}
    >
      <VStack gap={0.5}>
        <IconButton
          label="Zoom in"
          tooltip="Zoom in"
          icon={<PlusIcon />}
          variant="secondary"
          size="sm"
          onClick={() => stepZoom(ZOOM_STEP)}
        />
        <Button
          label="Reset zoom to 100%"
          tooltip="Reset zoom to 100%"
          variant="secondary"
          size="sm"
          onClick={resetZoom}
        >
          {percent}%
        </Button>
        <IconButton
          label="Zoom out"
          tooltip="Zoom out"
          icon={<MinusIcon />}
          variant="secondary"
          size="sm"
          onClick={() => stepZoom(1 / ZOOM_STEP)}
        />
        <IconButton
          label="Zoom to fit"
          tooltip="Zoom to fit"
          icon={<FitIcon />}
          variant="secondary"
          size="sm"
          onClick={fit}
        />
      </VStack>
    </div>
  );
}
