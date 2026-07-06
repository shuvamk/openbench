import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #43 acceptance — the copilot panel uses Astryx components/design tokens
 * only, never raw hex colors. Guards the feature's UI file against `#rrggbb`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const FILES = ["components/editor/CopilotPanel.tsx"];

// Matches a hex color literal like #fff, #ffffff, or #ffffffff.
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;

describe("copilot panel uses Astryx tokens, no raw hex", () => {
  for (const relative of FILES) {
    it(`${relative} contains no raw hex colors`, () => {
      const source = readFileSync(resolve(root, relative), "utf8");
      expect(source.match(HEX_COLOR) ?? []).toEqual([]);
    });
  }
});
