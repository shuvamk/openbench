import type { Component, Net, Schematic, SchematicInstance } from "@openbench/ir-schema";
import type {
  ComponentClause,
  ConnectedClause,
  Lesson,
  ParamConstraint,
  PinRef,
  ResolveComponent,
  SchematicPredicate,
  Step,
} from "@openbench/lesson";

/**
 * "Do it for me" auto-place (issue 153), per teaching-mode.md §7. When a step is
 * flagged {@link Step.allowAutoPlace}, the student can apply the minimal mutation
 * from the lesson's `targetBundle` that makes the step's predicate pass.
 *
 * The predicate references instances by *role* (e.g. `R`, `V`), never by the
 * target's or the student's instanceIds. So autoplace:
 *  1. binds every role to a target instance (component + `where` match, across
 *     the whole lesson, so a role introduced in an earlier step is still known);
 *  2. maps each needed role onto the live schematic — reusing an equivalent
 *     instance the student already placed, or importing a clone from the target;
 *  3. wires the step's `connected` clauses so the mapped pins share a net.
 *
 * The result reproduces exactly the substructure the target uses to satisfy the
 * step, grafted onto whatever the student already built — so `evaluateStep`
 * passes and the runner advances. Pure and registry-agnostic (resolver injected).
 */

/** Whether a step opts into the "do it for me" affordance. */
export function stepAllowsAutoPlace(step: Step): boolean {
  return step.allowAutoPlace === true;
}

/** Flatten a predicate to its component/connected leaves (any→first branch, not→skip). */
function walkClauses(pred: SchematicPredicate, out: {
  components: ComponentClause["component"][];
  connecteds: ConnectedClause["connected"][];
}): void {
  if ("all" in pred) {
    for (const p of pred.all) walkClauses(p, out);
  } else if ("any" in pred) {
    if (pred.any[0]) walkClauses(pred.any[0], out);
  } else if ("not" in pred) {
    // A negation cannot be auto-satisfied by adding structure — skip it.
  } else if ("component" in pred) {
    out.components.push(pred.component);
  } else {
    out.connecteds.push(pred.connected);
  }
}

function clausesOf(step: Step): {
  components: ComponentClause["component"][];
  connecteds: ConnectedClause["connected"][];
} {
  const out = { components: [] as ComponentClause["component"][], connecteds: [] as ConnectedClause["connected"][] };
  walkClauses(step.expect, out);
  return out;
}

/** Resolve a parameter value on an instance, falling back to the component default. */
function paramValue(
  instance: SchematicInstance,
  param: string,
  resolveComponent: ResolveComponent,
): number | string | boolean | undefined {
  const override = instance.parameterOverrides?.[param];
  if (override !== undefined) return override;
  const component: Component | undefined = resolveComponent(instance.componentId);
  return component?.parameters?.find((p) => p.name === param)?.default;
}

function satisfiesParam(value: number | string | boolean, c: ParamConstraint): boolean {
  if (c.eq !== undefined && value !== c.eq) return false;
  if (c.min !== undefined && !(typeof value === "number" && value >= c.min)) return false;
  if (c.max !== undefined && !(typeof value === "number" && value <= c.max)) return false;
  if (c.approx !== undefined) {
    if (typeof value !== "number") return false;
    const band = Math.abs(c.approx.value) * (c.approx.tolerancePct / 100);
    if (Math.abs(value - c.approx.value) > band) return false;
  }
  return true;
}

function matchesWhere(
  instance: SchematicInstance,
  where: ParamConstraint[] | undefined,
  resolveComponent: ResolveComponent,
): boolean {
  if (!where || where.length === 0) return true;
  return where.every((c) => {
    const value = paramValue(instance, c.param, resolveComponent);
    return value !== undefined && satisfiesParam(value, c);
  });
}

interface RoleBinding {
  componentId: string;
  where: ParamConstraint[] | undefined;
  targetInstance: SchematicInstance;
}

/**
 * Bind every declared role in the lesson to a distinct target instance, so a
 * role a step *references* (but does not declare) is still resolvable.
 */
function bindRolesToTarget(
  lesson: Lesson,
  target: Schematic,
  resolveComponent: ResolveComponent,
): Map<string, RoleBinding> {
  const roles = new Map<string, RoleBinding>();
  const usedTargetIds = new Set<string>();
  for (const step of lesson.steps) {
    const { components } = clausesOf(step);
    for (const clause of components) {
      if (clause.as === undefined || roles.has(clause.as)) continue;
      const match = target.instances.find(
        (i) =>
          i.componentId === clause.of &&
          !usedTargetIds.has(i.instanceId) &&
          matchesWhere(i, clause.where, resolveComponent),
      );
      if (match) {
        usedTargetIds.add(match.instanceId);
        roles.set(clause.as, { componentId: clause.of, where: clause.where, targetInstance: match });
      }
    }
  }
  return roles;
}

/** A fresh instanceId not already present in `taken`. */
function uniqueInstanceId(preferred: string, taken: Set<string>): string {
  if (!taken.has(preferred)) return preferred;
  let n = 2;
  while (taken.has(`${preferred}_${n}`)) n += 1;
  return `${preferred}_${n}`;
}

/**
 * Apply the minimal target-derived mutation so `step` passes against the live
 * schematic. Returns a new schematic (never mutates `current`).
 */
export function autoPlaceStep(
  lesson: Lesson,
  step: Step,
  current: Schematic,
  resolveComponent: ResolveComponent,
): Schematic {
  const target = lesson.targetBundle.schematic;
  const roleToTarget = bindRolesToTarget(lesson, target, resolveComponent);
  const { components, connecteds } = clausesOf(step);

  const instances: SchematicInstance[] = [...current.instances];
  const takenIds = new Set(instances.map((i) => i.instanceId));
  const roleToCurrentId = new Map<string, string>();
  const reusedCurrentIds = new Set<string>();

  /** Resolve a role to a live instanceId — reuse an equivalent, else import a clone. */
  function resolveRole(role: string): string | undefined {
    const cached = roleToCurrentId.get(role);
    if (cached !== undefined) return cached;
    const binding = roleToTarget.get(role);
    if (!binding) return undefined;
    const existing = instances.find(
      (i) =>
        i.componentId === binding.componentId &&
        !reusedCurrentIds.has(i.instanceId) &&
        matchesWhere(i, binding.where, resolveComponent),
    );
    if (existing) {
      reusedCurrentIds.add(existing.instanceId);
      roleToCurrentId.set(role, existing.instanceId);
      return existing.instanceId;
    }
    const id = uniqueInstanceId(binding.targetInstance.instanceId, takenIds);
    takenIds.add(id);
    const clone: SchematicInstance = {
      ...binding.targetInstance,
      instanceId: id,
    };
    instances.push(clone);
    roleToCurrentId.set(role, id);
    return id;
  }

  // Ensure every component clause's role is present (declared roles bind first).
  for (const clause of components) {
    if (clause.as !== undefined) resolveRole(clause.as);
  }

  const nets: Net[] = current.nets.map((n) => ({ ...n, connections: [...n.connections] }));
  const usedNetIds = new Set(nets.map((n) => n.netId));

  /** Resolve a pin-ref to a concrete connection, or a named-net target. */
  function resolvePin(ref: PinRef): { connection?: { instanceId: string; pinId: string }; netName?: string } {
    if ("net" in ref) return { netName: ref.net };
    const instanceId = resolveRole(ref.role);
    if (instanceId === undefined) return {};
    return { connection: { instanceId, pinId: ref.pin } };
  }

  for (const clause of connecteds) {
    const resolved = clause.pins.map(resolvePin);
    const connections = resolved
      .map((r) => r.connection)
      .filter((c): c is { instanceId: string; pinId: string } => c !== undefined);
    if (connections.length === 0) continue;
    const namedNet = resolved.find((r) => r.netName !== undefined)?.netName;

    // Prefer a named net, then any net already holding one of these pins, else new.
    let net =
      (namedNet !== undefined
        ? nets.find((n) => n.name?.toUpperCase() === namedNet.toUpperCase())
        : undefined) ??
      nets.find((n) =>
        n.connections.some((c) =>
          connections.some((pc) => pc.instanceId === c.instanceId && pc.pinId === c.pinId),
        ),
      );
    if (!net) {
      const netId = uniqueInstanceId(`net_auto_${step.id}`, usedNetIds);
      usedNetIds.add(netId);
      net = { netId, ...(namedNet !== undefined ? { name: namedNet } : {}), connections: [] };
      nets.push(net);
    }
    for (const pc of connections) {
      if (!net.connections.some((c) => c.instanceId === pc.instanceId && c.pinId === pc.pinId)) {
        net.connections.push(pc);
      }
    }
  }

  return { ...current, instances, nets };
}
