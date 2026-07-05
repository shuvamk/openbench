/** Current IR version. Pre-1.0: a minor bump is a breaking change (spec §principles). */
export const IR_VERSION = "0.1.1";

/**
 * A document is supported when its major.minor matches the current IR version —
 * pre-1.0, patch differences are compatible, minor differences are breaking.
 */
export function isSupportedIrVersion(version: string): boolean {
  const [major, minor] = IR_VERSION.split(".");
  const parts = version.split(".");
  return parts.length === 3 && parts[0] === major && parts[1] === minor;
}
