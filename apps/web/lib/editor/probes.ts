import type { Probe, Schematic } from "@openbench/ir-schema";
import { snapToGrid, type Point } from "./mutations";

/**
 * Pure, immutable scope-probe helpers (issue #37). Probes are additive editor
 * geometry stored under `schematic.layout.probes`; each names the net it
 * watches and where its on-canvas marker sits. The waveform viewer reads
 * `activeProbeNetIds` to decide which signals to plot. Like ./mutations, every
 * function returns a NEW schematic that still passes `validateSchematic`.
 */

/** netIds currently probed, in drop order — the viewer's active-signal set. */
export function activeProbeNetIds(schematic: Schematic): string[] {
  return (schematic.layout?.probes ?? []).map((probe) => probe.netId);
}

/** True when a scope probe already watches `netId`. */
export function isNetProbed(schematic: Schematic, netId: string): boolean {
  return (schematic.layout?.probes ?? []).some((probe) => probe.netId === netId);
}

function nextProbeId(schematic: Schematic): string {
  let max = 0;
  for (const probe of schematic.layout?.probes ?? []) {
    const match = probe.probeId.match(/^prb_(\d+)$/);
    if (match?.[1]) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `prb_${max + 1}`;
}

/**
 * Drop a scope probe on a declared net, snapping the marker to the grid. Idempotent
 * per net (re-dropping on a probed net is a no-op) and a no-op for undeclared nets,
 * so the returned schematic always validates and active signals stay a set.
 */
export function addProbe(
  schematic: Schematic,
  netId: string,
  position: Point,
  color?: string,
): Schematic {
  if (!schematic.nets.some((net) => net.netId === netId)) return schematic;
  if (isNetProbed(schematic, netId)) return schematic;

  const probe: Probe = {
    probeId: nextProbeId(schematic),
    netId,
    x: snapToGrid(position.x),
    y: snapToGrid(position.y),
    ...(color !== undefined ? { color } : {}),
  };
  return {
    ...schematic,
    layout: {
      instances: schematic.layout?.instances ?? {},
      probes: [...(schematic.layout?.probes ?? []), probe],
    },
  };
}

/** Remove a probe by id; unknown ids are a no-op. */
export function removeProbe(schematic: Schematic, probeId: string): Schematic {
  const probes = schematic.layout?.probes ?? [];
  if (!probes.some((probe) => probe.probeId === probeId)) return schematic;
  return {
    ...schematic,
    layout: {
      instances: schematic.layout?.instances ?? {},
      probes: probes.filter((probe) => probe.probeId !== probeId),
    },
  };
}
