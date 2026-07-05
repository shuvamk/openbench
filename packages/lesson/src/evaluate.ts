import type { Schematic, SchematicInstance } from "@openbench/ir-schema";
import type { Violation } from "@openbench/erc";
import type {
  ClauseResult,
  ComponentClause,
  ConnectedClause,
  ErcRunner,
  ParamConstraint,
  PinRef,
  ResolveComponent,
  SchematicPredicate,
  Step,
  StepResult,
} from "./types";

/**
 * Subset-match SchematicPredicate evaluator (issue #89), per
 * .context/design/teaching-mode.md §3 (ADR-0022).
 *
 * A step passes when there exists an injective binding of role variables to
 * distinct schematic instances such that every clause of its `expect` predicate
 * holds. Matching is *existential* (some binding suffices) and by *subset* (a
 * `connected` clause holds as long as its pins share one net — the net may carry
 * others), which makes it monotone: adding correct structure never turns a
 * passing step red. Roles referenced only inside `connected` clauses are free
 * existential variables (bound to any instance carrying the named pin on the
 * shared net), so a later step reuses the parts an earlier step introduced
 * without re-declaring them.
 *
 * Component resolution is injected and the evaluator never throws — an
 * unresolved component simply yields no candidate, so the step reports
 * `passed:false`. An optional ERC runner feeds advisory warnings (filtered to
 * instances/nets bound in the step) that never change the structural verdict.
 */
export function evaluateStep(
  step: Step,
  schematic: Schematic,
  resolveComponent: ResolveComponent,
  erc?: ErcRunner,
): StepResult {
  const index = new SchematicIndex(schematic, resolveComponent);

  // Find one satisfying binding for the whole predicate (drives `passed` and
  // the ERC warning scope).
  let passingBinding: Map<string, string> | undefined;
  const passed = satisfy(step.expect, new Map(), index, (binding) => {
    passingBinding = new Map(binding);
    return true;
  });

  return {
    passed,
    clauses: describeTopLevel(step.expect, index, passed),
    warnings: erc ? deriveWarnings(erc, schematic, resolveComponent, passingBinding) : [],
  };
}

const pinKey = (instanceId: string, pinId: string): string => `${instanceId} ${pinId}`;

/** Precomputed schematic lookups shared across the recursive match. */
class SchematicIndex {
  readonly instances: SchematicInstance[];
  private readonly netIdByPin = new Map<string, string>();
  private readonly netNameById = new Map<string, string | undefined>();
  private readonly pinsByNet = new Map<string, { instanceId: string; pinId: string }[]>();
  readonly netIds: string[];

  constructor(
    schematic: Schematic,
    private readonly resolveComponent: ResolveComponent,
  ) {
    this.instances = schematic?.instances ?? [];
    for (const net of schematic?.nets ?? []) {
      this.netNameById.set(net.netId, net.name);
      const refs: { instanceId: string; pinId: string }[] = [];
      for (const connection of net.connections ?? []) {
        this.netIdByPin.set(pinKey(connection.instanceId, connection.pinId), net.netId);
        refs.push({ instanceId: connection.instanceId, pinId: connection.pinId });
      }
      this.pinsByNet.set(net.netId, refs);
    }
    this.netIds = [...this.netNameById.keys()];
  }

  netOfPin(instanceId: string, pinId: string): string | undefined {
    return this.netIdByPin.get(pinKey(instanceId, pinId));
  }

  netName(netId: string): string | undefined {
    return this.netNameById.get(netId);
  }

  pinsOnNet(netId: string): { instanceId: string; pinId: string }[] {
    return this.pinsByNet.get(netId) ?? [];
  }

  /**
   * Instances of `of` whose parameters satisfy every `where` constraint. An
   * unresolved component matches nothing (it is unverifiable, never a throw).
   */
  candidates(clause: ComponentClause["component"]): SchematicInstance[] {
    return this.instances.filter((instance) => {
      if (instance.componentId !== clause.of) return false;
      const component = this.resolveComponent(instance.componentId);
      if (component === undefined) return false;
      const where = clause.where ?? [];
      if (where.length === 0) return true;
      const defaults = new Map(
        (component.parameters ?? []).map((p) => [p.name, p.default] as const),
      );
      return where.every((constraint) => {
        const value = instance.parameterOverrides?.[constraint.param] ?? defaults.get(constraint.param);
        return value !== undefined && satisfiesParam(value, constraint);
      });
    });
  }
}

const usedInstances = (binding: Map<string, string>): Set<string> => new Set(binding.values());

function satisfiesParam(value: number | string | boolean, constraint: ParamConstraint): boolean {
  if (constraint.eq !== undefined && value !== constraint.eq) return false;
  if (constraint.min !== undefined && !(typeof value === "number" && value >= constraint.min)) {
    return false;
  }
  if (constraint.max !== undefined && !(typeof value === "number" && value <= constraint.max)) {
    return false;
  }
  if (constraint.approx !== undefined) {
    if (typeof value !== "number") return false;
    const tolerance = Math.abs(constraint.approx.value) * (constraint.approx.tolerancePct / 100);
    if (Math.abs(value - constraint.approx.value) > tolerance) return false;
  }
  return true;
}

/**
 * Backtracking matcher: try to extend `binding` so `pred` holds, then invoke
 * `cont`. Returns true iff some extension satisfies both. `binding` is mutated
 * in place and always restored on failure.
 */
function satisfy(
  pred: SchematicPredicate,
  binding: Map<string, string>,
  index: SchematicIndex,
  cont: (binding: Map<string, string>) => boolean,
): boolean {
  if ("all" in pred) return satisfyAll(pred.all, 0, binding, index, cont);
  if ("any" in pred) return pred.any.some((child) => satisfy(child, binding, index, cont));
  if ("not" in pred) {
    // Closed-world negation: satisfied iff the inner predicate has no binding
    // extending the current one. It must not leak any bindings of its own.
    const matchable = satisfy(pred.not, new Map(binding), index, () => true);
    return !matchable && cont(binding);
  }
  if ("component" in pred) return satisfyComponent(pred, binding, index, cont);
  return satisfyConnected(pred, binding, index, cont);
}

function satisfyAll(
  children: SchematicPredicate[],
  i: number,
  binding: Map<string, string>,
  index: SchematicIndex,
  cont: (binding: Map<string, string>) => boolean,
): boolean {
  if (i === children.length) return cont(binding);
  return satisfy(children[i]!, binding, index, () =>
    satisfyAll(children, i + 1, binding, index, cont),
  );
}

function satisfyComponent(
  clause: ComponentClause,
  binding: Map<string, string>,
  index: SchematicIndex,
  cont: (binding: Map<string, string>) => boolean,
): boolean {
  const spec = clause.component;
  const matches = index.candidates(spec);

  // Cardinality over ALL matching instances (default at least one).
  const min = spec.count?.min ?? 1;
  const max = spec.count?.max;
  if (matches.length < min || (max !== undefined && matches.length > max)) return false;

  if (spec.as === undefined) return cont(binding);

  const role = spec.as;
  const used = usedInstances(binding);
  for (const instance of matches) {
    if (used.has(instance.instanceId)) continue; // distinct roles → distinct instances
    binding.set(role, instance.instanceId);
    if (cont(binding)) return true;
    binding.delete(role);
  }
  return false;
}

function satisfyConnected(
  clause: ConnectedClause,
  binding: Map<string, string>,
  index: SchematicIndex,
  cont: (binding: Map<string, string>) => boolean,
): boolean {
  const pins = clause.connected.pins;

  // Narrow the shared net using the already-constrained refs (named nets and
  // already-bound roles), then existentially assign the free-role refs.
  let candidateNets = index.netIds;
  for (const ref of pins) {
    if ("net" in ref) {
      candidateNets = candidateNets.filter((n) => nameEq(index.netName(n), ref.net));
    } else if (binding.has(ref.role)) {
      const netId = index.netOfPin(binding.get(ref.role)!, ref.pin);
      candidateNets = netId === undefined ? [] : candidateNets.filter((n) => n === netId);
    }
  }

  for (const netId of candidateNets) {
    if (assignPins(pins, 0, netId, binding, index, cont)) return true;
  }
  return false;
}

function assignPins(
  pins: PinRef[],
  i: number,
  netId: string,
  binding: Map<string, string>,
  index: SchematicIndex,
  cont: (binding: Map<string, string>) => boolean,
): boolean {
  if (i === pins.length) return cont(binding);
  const ref = pins[i]!;

  if ("net" in ref) {
    // Named-net refs were already validated against `netId` in the caller.
    return assignPins(pins, i + 1, netId, binding, index, cont);
  }

  if (binding.has(ref.role)) {
    if (index.netOfPin(binding.get(ref.role)!, ref.pin) !== netId) return false;
    return assignPins(pins, i + 1, netId, binding, index, cont);
  }

  // Free role: bind to any distinct instance carrying `pin` on this net.
  const used = usedInstances(binding);
  for (const candidate of index.pinsOnNet(netId)) {
    if (candidate.pinId !== ref.pin || used.has(candidate.instanceId)) continue;
    binding.set(ref.role, candidate.instanceId);
    if (assignPins(pins, i + 1, netId, binding, index, cont)) return true;
    binding.delete(ref.role);
  }
  return false;
}

const nameEq = (a: string | undefined, b: string): boolean =>
  a !== undefined && a.toUpperCase() === b.toUpperCase();

// ── Per-clause diagnostics ──────────────────────────────────────────────────

/**
 * Report one entry per top-level clause in author order. When the step passes
 * every clause is satisfied; otherwise each clause's independent satisfiability
 * drives incremental "n / m done" progress and targeted hints.
 */
function describeTopLevel(
  expect: SchematicPredicate,
  index: SchematicIndex,
  passed: boolean,
): ClauseResult[] {
  const topLevel = "all" in expect ? expect.all : [expect];
  return topLevel.map((clause) => ({
    satisfied: passed || satisfy(clause, new Map(), index, () => true),
    describe: describeClause(clause),
    ...hintKeyFor(clause),
  }));
}

function hintKeyFor(clause: SchematicPredicate): { hintKey?: string } {
  if ("component" in clause) return { hintKey: "missing-component" };
  if ("connected" in clause) return { hintKey: "missing-connection" };
  return {};
}

function describeClause(clause: SchematicPredicate): string {
  if ("all" in clause) return `all of ${clause.all.length} conditions`;
  if ("any" in clause) return `any of ${clause.any.length} conditions`;
  if ("not" in clause) return `not: ${describeClause(clause.not)}`;
  if ("component" in clause) {
    const { of, where } = clause.component;
    const constraints = (where ?? []).map(describeConstraint).join(", ");
    return constraints ? `a ${of} (${constraints})` : `a ${of}`;
  }
  const pins = clause.connected.pins.map(describePin).join(" — ");
  return `${pins} share a net`;
}

function describeConstraint(constraint: ParamConstraint): string {
  const { param, eq, approx, min, max } = constraint;
  if (approx !== undefined) return `${param} ≈ ${approx.value} ±${approx.tolerancePct}%`;
  if (eq !== undefined) return `${param} = ${eq}`;
  if (min !== undefined && max !== undefined) return `${param} ∈ [${min}, ${max}]`;
  if (min !== undefined) return `${param} ≥ ${min}`;
  if (max !== undefined) return `${param} ≤ ${max}`;
  return param;
}

const describePin = (ref: PinRef): string =>
  "net" in ref ? `net ${ref.net}` : `${ref.role}.${ref.pin}`;

// ── ERC warning feed (§3.4) ─────────────────────────────────────────────────

/** ERC rule → templated teaching-step warning (design/teaching-mode.md §3.4). */
const WARNING_TEMPLATES: Record<string, string> = {
  ERC_FLOATING_PIN: "A pin is placed but not wired to anything yet.",
  ERC_NO_GROUND: "Your circuit has no ground reference — add a Ground symbol.",
  ERC_SINGLE_PIN_NET: "This wire only touches one pin — connect the other end.",
  ERC_POWER_NOT_DRIVEN: "This rail isn't driven by a source.",
  ERC_OUTPUT_CONFLICT: "Two outputs are shorted together.",
  ERC_UNRESOLVED_COMPONENT: "This part isn't in the registry — pick one from the palette.",
};

/**
 * Run ERC and surface the violations touching an instance or net bound in this
 * step, mapped to teaching-step hint text. Before a structural match there is
 * no binding, so every violation is in scope (the whole step is unsatisfied).
 */
function deriveWarnings(
  erc: ErcRunner,
  schematic: Schematic,
  resolveComponent: ResolveComponent,
  binding: Map<string, string> | undefined,
): string[] {
  const { violations } = erc(schematic, resolveComponent);
  const boundInstances = binding ? new Set(binding.values()) : undefined;
  const boundNets = boundInstances ? netsTouching(schematic, boundInstances) : undefined;

  const inScope = (violation: Violation): boolean => {
    if (boundInstances === undefined) return true; // unbound step: nothing to narrow to
    return (
      (violation.instanceIds ?? []).some((id) => boundInstances.has(id)) ||
      (violation.netIds ?? []).some((n) => boundNets!.has(n))
    );
  };

  return violations
    .filter(inScope)
    .map((violation) => WARNING_TEMPLATES[violation.rule] ?? violation.message);
}

function netsTouching(schematic: Schematic, instanceIds: Set<string>): Set<string> {
  const nets = new Set<string>();
  for (const net of schematic?.nets ?? []) {
    if ((net.connections ?? []).some((c) => instanceIds.has(c.instanceId))) nets.add(net.netId);
  }
  return nets;
}
