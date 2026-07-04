import type { Component, Net, Schematic } from "@openbench/ir-schema";

/**
 * Electrical-rule-check engine (issue #35). A pure function over the schematic
 * IR that reports what is electrically wrong *before* a sim run is spent —
 * missing ground, floating pins, undriven power inputs, output contention, and
 * stub nets. Component resolution is injected so the package stays decoupled
 * from the registry, exactly like the netlist compiler.
 *
 * It never throws: malformed input (an unresolved component, a missing field)
 * becomes a violation, so callers can render results without a try/catch.
 */

export type Severity = "error" | "warning";

export interface Violation {
  severity: Severity;
  /** Stable machine code, e.g. `ERC_NO_GROUND` — matches `^ERC_[A-Z_]+$`. */
  rule: string;
  /** Human-readable, self-contained explanation. */
  message: string;
  /** Instances implicated by the violation (for canvas highlighting). */
  instanceIds?: string[];
  /** Nets implicated by the violation. */
  netIds?: string[];
}

export interface ErcResult {
  violations: Violation[];
}

/** Net names that denote SPICE ground (compared case-insensitively). */
const GROUND_NET_NAMES = new Set(["GND", "AGND", "0"]);
/** Registry ground symbol; any net touching one is ground. */
const GROUND_COMPONENT_ID = "cmp_ground";

/** Pin types that actively drive a net. */
const DRIVER_TYPES = new Set(["output", "power_out"]);

const connectionKey = (instanceId: string, pinId: string): string =>
  `${instanceId} ${pinId}`;

/** A source is a voltage/current source: its SPICE template starts with V/I. */
function isSource(component: Component | undefined): boolean {
  const template = component?.simModel?.template ?? "";
  return /^[VI]\{ref\}/.test(template);
}

function isGroundNet(net: Net, groundInstanceIds: ReadonlySet<string>): boolean {
  if (net.name !== undefined && GROUND_NET_NAMES.has(net.name.toUpperCase())) {
    return true;
  }
  return (net.connections ?? []).some((c) => groundInstanceIds.has(c.instanceId));
}

/**
 * Run every electrical rule over a schematic IR document.
 *
 * @param schematic         the schematic to check
 * @param resolveComponent  maps a componentId to its Component IR (or undefined)
 */
export function checkSchematic(
  schematic: Schematic,
  resolveComponent: (id: string) => Component | undefined,
): ErcResult {
  const violations: Violation[] = [];
  const instances = schematic?.instances ?? [];
  const nets = schematic?.nets ?? [];

  // Resolve every instance once; an unresolved id is itself a violation.
  const componentOf = new Map<string, Component | undefined>();
  for (const instance of instances) {
    const component = resolveComponent(instance.componentId);
    componentOf.set(instance.instanceId, component);
    if (component === undefined) {
      violations.push({
        severity: "error",
        rule: "ERC_UNRESOLVED_COMPONENT",
        message: `instance "${instance.instanceId}" references unknown component "${instance.componentId}"`,
        instanceIds: [instance.instanceId],
      });
    }
  }

  const groundInstanceIds = new Set(
    instances
      .filter((i) => i.componentId === GROUND_COMPONENT_ID)
      .map((i) => i.instanceId),
  );

  // pin → netId, and netId → the pins on it (with resolved electrical type).
  const netIdByPin = new Map<string, string>();
  interface PinRef {
    instanceId: string;
    pinId: string;
    electricalType: string | undefined;
  }
  const pinsByNet = new Map<string, PinRef[]>();
  const groundNetIds = new Set<string>();

  for (const net of nets) {
    if (isGroundNet(net, groundInstanceIds)) groundNetIds.add(net.netId);
    const refs: PinRef[] = [];
    for (const connection of net.connections ?? []) {
      netIdByPin.set(connectionKey(connection.instanceId, connection.pinId), net.netId);
      const component = componentOf.get(connection.instanceId);
      const pin = component?.pins.find((p) => p.id === connection.pinId);
      refs.push({
        instanceId: connection.instanceId,
        pinId: connection.pinId,
        electricalType: pin?.electricalType,
      });
    }
    pinsByNet.set(net.netId, refs);
  }

  // ── Rule: no ground when the circuit has a source ────────────────────────
  const hasSource = instances.some((i) => isSource(componentOf.get(i.instanceId)));
  const hasGround = groundInstanceIds.size > 0 || groundNetIds.size > 0;
  if (hasSource && !hasGround) {
    violations.push({
      severity: "error",
      rule: "ERC_NO_GROUND",
      message: "circuit has a source but no ground reference (add a Ground symbol or a GND net)",
    });
  }

  // ── Rule: floating pins (declared pin on no net) ─────────────────────────
  for (const instance of instances) {
    const component = componentOf.get(instance.instanceId);
    if (component === undefined) continue; // already reported as unresolved
    for (const pin of component.pins) {
      if (!netIdByPin.has(connectionKey(instance.instanceId, pin.id))) {
        violations.push({
          severity: "warning",
          rule: "ERC_FLOATING_PIN",
          message: `pin "${pin.name}" (${pin.id}) of "${instance.instanceId}" is not connected to any net`,
          instanceIds: [instance.instanceId],
        });
      }
    }
  }

  // ── Rules over each net: output conflict, undriven power, stub nets ───────
  for (const net of nets) {
    const refs = pinsByNet.get(net.netId) ?? [];

    if ((net.connections?.length ?? 0) < 2) {
      violations.push({
        severity: "warning",
        rule: "ERC_SINGLE_PIN_NET",
        message: `net "${net.name ?? net.netId}" has fewer than two pins — nothing is connected across it`,
        netIds: [net.netId],
      });
    }

    const drivers = refs.filter((r) => r.electricalType !== undefined && DRIVER_TYPES.has(r.electricalType));
    if (drivers.length >= 2) {
      const instanceIds = [...new Set(drivers.map((d) => d.instanceId))];
      violations.push({
        severity: "error",
        rule: "ERC_OUTPUT_CONFLICT",
        message: `net "${net.name ?? net.netId}" is driven by multiple outputs: ${instanceIds.join(", ")}`,
        instanceIds,
        netIds: [net.netId],
      });
    }

    // Power inputs on a non-ground net with no driver are undriven. Ground-
    // symbol pins are references, not loads, so they never need a driver.
    const isGround = groundNetIds.has(net.netId);
    if (!isGround && drivers.length === 0) {
      for (const ref of refs) {
        if (ref.electricalType === "power_in" && !groundInstanceIds.has(ref.instanceId)) {
          violations.push({
            severity: "error",
            rule: "ERC_POWER_NOT_DRIVEN",
            message: `power input "${ref.pinId}" of "${ref.instanceId}" is on net "${net.name ?? net.netId}", which nothing drives`,
            instanceIds: [ref.instanceId],
            netIds: [net.netId],
          });
        }
      }
    }
  }

  return { violations };
}
