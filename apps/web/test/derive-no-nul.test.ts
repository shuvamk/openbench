import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for issue #104: `lib/live/derive.ts` built its pinNet map
 * keys with a literal NUL (0x00) byte delimiter (`${instanceId}\x00${pinId}`).
 * A NUL anywhere in a file makes git render it as a `Bin` diff — no line-level
 * review, no blame — and ripgrep/grep silently skip it as binary, so reviewers
 * and tooling can't see or search the source. Runtime was unaffected, so only a
 * byte-level assertion catches it. The fix uses a printable delimiter (a space,
 * matching lib/editor/erc.ts and packages/lesson's `${instanceId} ${pinId}`).
 */
const DERIVE_PATH = fileURLToPath(new URL("../lib/live/derive.ts", import.meta.url));

describe("lib/live/derive.ts source hygiene", () => {
  it("contains no NUL (0x00) bytes, so git and grep treat it as text", () => {
    const bytes = readFileSync(DERIVE_PATH);
    expect(bytes.includes(0x00)).toBe(false);
  });

  it("still exports its live-derivation API (file is readable as text)", () => {
    const text = readFileSync(DERIVE_PATH, "utf8");
    expect(text).toMatch(/export /);
  });
});
