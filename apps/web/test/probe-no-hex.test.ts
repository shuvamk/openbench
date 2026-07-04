import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Astryx design-system rule (issue #37 acceptance): the probe + waveform-v2 UI
 * must use design tokens, never raw hex colors. This guards the files touched
 * by the feature against `#rrggbb`-style literals.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const FILES = [
  "components/sim/WaveformViewer.tsx",
  "components/editor/SchematicCanvas.tsx",
  "components/editor/Palette.tsx",
  "components/sim/SimPanel.tsx",
  "lib/editor/probes.ts",
  "lib/sim/cursors.ts",
];

// Matches a hex color literal like #fff, #ffffff, or #ffffffff.
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;

describe("probe + waveform UI uses Astryx tokens, no raw hex", () => {
  for (const relative of FILES) {
    it(`${relative} contains no raw hex colors`, () => {
      const source = readFileSync(resolve(root, relative), "utf8");
      expect(source.match(HEX_COLOR) ?? []).toEqual([]);
    });
  }
});
