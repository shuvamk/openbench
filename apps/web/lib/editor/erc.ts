import type { Component, Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { checkSchematic, type Severity, type Violation } from "@openbench/erc";

/**
 * ERC view-model (issue #71): turn `@openbench/erc`'s machine `Violation`s into
 * plain-language issues a beginner can act on, and index them by instance so
 * the canvas can badge the offending parts. Pure functions, no React — mirrors
 * `lib/live/derive.ts` so the Inspector and canvas can memoize off the bundle.
 *
 * Hard rule: no `ERC_*` machine code ever appears in a rendered `message`. The
 * UI reads `message`; `rule` stays internal to the humanizer here.
 */

export interface ErcIssue {
  severity: Severity;
  /** Plain-language, self-contained explanation — never an ERC_ code. */
  message: string;
  /** Instances implicated (canvas highlighting + click-to-select). */
  instanceIds: string[];
  /** Nets implicated. */
  netIds: string[];
  /** First implicated instance, for click-to-select from the Inspector. */
  primaryInstanceId?: string;
}

/**
 * Derive the ordered list of human-readable ERC issues for a schematic.
 * Component resolution is injected (defaulting to the registry) so this stays
 * unit-testable without the registry singleton, exactly like the ERC engine.
 */
export function deriveErcIssues(
  schematic: Schematic,
  resolveComponent: (id: string) => Component | undefined = getComponent,
): ErcIssue[] {
  const { violations } = checkSchematic(schematic, resolveComponent);
  return violations.map((violation) => toIssue(violation, schematic));
}

/**
 * Map each instance to the highest severity affecting it (error beats
 * warning), so the canvas can pick a single badge color per part.
 */
export function instanceSeverities(issues: ErcIssue[]): Map<string, Severity> {
  const byInstance = new Map<string, Severity>();
  for (const issue of issues) {
    for (const instanceId of issue.instanceIds) {
      if (byInstance.get(instanceId) !== "error") {
        byInstance.set(instanceId, issue.severity);
      }
    }
  }
  return byInstance;
}

function toIssue(violation: Violation, schematic: Schematic): ErcIssue {
  const instanceIds = violation.instanceIds ?? [];
  const netIds = violation.netIds ?? [];
  return {
    severity: violation.severity,
    message: humanize(violation, schematic),
    instanceIds,
    netIds,
    primaryInstanceId: instanceIds[0],
  };
}

/** Human label for a net: its name if it has one, else its id. */
function netLabel(schematic: Schematic, netId: string | undefined): string {
  const net = schematic.nets.find((n) => n.netId === netId);
  return net?.name ?? netId ?? "a net";
}

/**
 * Recover the offending pin label from an ERC message shaped like
 * `pin "K" (cathode) of "D1"`. Prefers the descriptive pin id in parens
 * (e.g. "cathode") over the terse display name (e.g. "K").
 */
function pinLabelFromMessage(message: string): string | undefined {
  const paren = /\(([a-zA-Z0-9_]+)\)/.exec(message);
  if (paren) return paren[1];
  const quoted = /pin "([^"]+)"/.exec(message);
  return quoted?.[1];
}

/** Defensive: never let a machine code reach the UI, even for unknown rules. */
const stripCodes = (message: string): string =>
  message.replace(/\bERC_[A-Z_]+\b/g, "an electrical issue");

function humanize(violation: Violation, schematic: Schematic): string {
  const instanceId = violation.instanceIds?.[0];
  switch (violation.rule) {
    case "ERC_NO_GROUND":
      return "This circuit has no ground — add a ground symbol so current has a return path.";

    case "ERC_FLOATING_PIN": {
      const pin = pinLabelFromMessage(violation.message);
      if (instanceId && pin) return `${instanceId} pin “${pin}” isn’t connected to anything.`;
      if (instanceId) return `${instanceId} has a pin that isn’t connected.`;
      return "A pin isn’t connected to anything.";
    }

    case "ERC_SINGLE_PIN_NET":
      return `The “${netLabel(schematic, violation.netIds?.[0])}” net only touches one pin — nothing is connected across it.`;

    case "ERC_POWER_NOT_DRIVEN": {
      const pin = pinLabelFromMessage(violation.message);
      const where = instanceId ? `${instanceId}${pin ? ` pin “${pin}”` : ""}` : "A part";
      return `${where} needs power, but nothing is driving its net.`;
    }

    case "ERC_OUTPUT_CONFLICT": {
      const drivers = (violation.instanceIds ?? []).join(" and ");
      return `${drivers || "Two outputs"} are driving the same net — only one output may drive a net.`;
    }

    case "ERC_UNRESOLVED_COMPONENT":
      return instanceId
        ? `${instanceId} uses a part that isn’t in the component library.`
        : "A part isn’t in the component library.";

    default:
      return stripCodes(violation.message);
  }
}
