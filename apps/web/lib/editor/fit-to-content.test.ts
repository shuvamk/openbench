import { describe, expect, it } from "vitest";
import { fitToContent, type ComponentBounds } from "./geometry";
import { MIN_ZOOM, MAX_ZOOM } from "./store";

const VIEWPORT = { width: 800, height: 600 };

describe("fitToContent", () => {
  it("returns the identity/default view for an empty schematic (no NaN)", () => {
    const view = fitToContent([], VIEWPORT);
    expect(view.zoom).toBe(1);
    expect(view.pan).toEqual({ x: 0, y: 0 });
    expect(Number.isNaN(view.zoom)).toBe(false);
    expect(Number.isNaN(view.pan.x)).toBe(false);
    expect(Number.isNaN(view.pan.y)).toBe(false);
  });

  it("frames a single component centered in the viewport", () => {
    const comps: ComponentBounds[] = [{ x: 100, y: 100, halfWidth: 30, halfHeight: 10 }];
    const view = fitToContent(comps, VIEWPORT);
    // The content center (100,100) maps to the viewport center in screen space:
    // screen = world * zoom + pan  ⇒  center at (width/2, height/2).
    expect(view.pan.x + 100 * view.zoom).toBeCloseTo(VIEWPORT.width / 2, 5);
    expect(view.pan.y + 100 * view.zoom).toBeCloseTo(VIEWPORT.height / 2, 5);
  });

  it("frames several components so their bounding box fits with margin", () => {
    const comps: ComponentBounds[] = [
      { x: 0, y: 0, halfWidth: 20, halfHeight: 20 },
      { x: 400, y: 300, halfWidth: 20, halfHeight: 20 },
    ];
    const view = fitToContent(comps, VIEWPORT);
    // Every corner of the content bbox must land inside the viewport.
    const project = (wx: number, wy: number) => ({
      x: wx * view.zoom + view.pan.x,
      y: wy * view.zoom + view.pan.y,
    });
    const tl = project(-20, -20);
    const br = project(420, 320);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(VIEWPORT.width);
    expect(br.y).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("clamps the computed zoom to [MIN_ZOOM, MAX_ZOOM]", () => {
    // A tiny component would want to zoom way past MAX_ZOOM to fill the frame.
    const tiny: ComponentBounds[] = [{ x: 0, y: 0, halfWidth: 1, halfHeight: 1 }];
    expect(fitToContent(tiny, VIEWPORT).zoom).toBeLessThanOrEqual(MAX_ZOOM);

    // A huge component would want to zoom below MIN_ZOOM to fit.
    const huge: ComponentBounds[] = [{ x: 0, y: 0, halfWidth: 100000, halfHeight: 100000 }];
    expect(fitToContent(huge, VIEWPORT).zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
});
