import { z } from "zod";
import { irVersionField, provenanceSchema } from "./provenance";
import { runSchema, type ValidationResult } from "./validate";

/** KiCad-aligned pin electrical types (glossary: "Pin"). */
export const electricalTypes = [
  "passive",
  "input",
  "output",
  "bidirectional",
  "power_in",
  "power_out",
  "open_collector",
  "tri_state",
  "unspecified",
  "no_connect",
] as const;

const pinSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  electricalType: z.enum(electricalTypes),
});

const parameterSchema = z.object({
  name: z.string().min(1),
  unit: z.string().optional(),
  default: z.union([z.number(), z.string(), z.boolean()]),
  type: z.enum(["number", "string", "boolean"]),
});

const simModelSchema = z.object({
  engine: z.enum(["ngspice"]),
  /** May span multiple lines: the netlist compiler emits one SPICE card per line (issue #21). */
  template: z.string().min(1),
  /** Optional SPICE `.model` card emitted alongside the template (additive, issue #5). */
  modelCard: z.string().min(1).optional(),
  /**
   * Optional SPICE `.subckt … .ends` definition block (additive, issue #34).
   * Pairs with an `X{ref} <nodes> <name>` template; the netlist compiler emits
   * one `X` device card per instance and the definition block once (deduped by
   * content, like `modelCard`). The block is opaque — its internal nodes are
   * local to the subcircuit; only the template's `{pin}` tokens map to outer nets.
   */
  subckt: z.string().min(1).optional(),
  /**
   * Arithmetic expressions over declared parameter names (additive, issue #21).
   * Allowed: numeric literals (incl. 1e12 style), declared parameter names,
   * `+ - * /` and parentheses — nothing else. Template tokens may reference keys.
   */
  derivedParams: z.record(z.string()).optional(),
});

/** One lexical token of a derivedParams expression. */
const EXPRESSION_TOKEN =
  /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[+\-*/()]|\s+/y;

/**
 * Tokenize a derivedParams expression and report the first structural problem:
 * an identifier that is not a declared parameter name, or any character outside
 * numbers / identifiers / `+ - * /` / parentheses / whitespace.
 */
function findExpressionProblem(
  expression: string,
  declaredParameters: ReadonlySet<string>,
): string | undefined {
  let position = 0;
  while (position < expression.length) {
    EXPRESSION_TOKEN.lastIndex = position;
    const match = EXPRESSION_TOKEN.exec(expression);
    if (match === null) {
      return `invalid character "${expression[position]}" (allowed: numbers, declared parameter names, + - * / and parentheses)`;
    }
    const token = match[0];
    if (/^[A-Za-z_]/.test(token) && !declaredParameters.has(token)) {
      return `references undeclared parameter "${token}"`;
    }
    position = EXPRESSION_TOKEN.lastIndex;
  }
  return undefined;
}

/**
 * Base object shape without cross-field refinements — the discriminated union
 * in ./document composes these and re-applies `refineComponent`.
 */
export const componentObjectSchema = z.object({
  irVersion: irVersionField,
  kind: z.literal("component"),
  id: z.string().regex(/^cmp_[a-z0-9_]+$/, "component ids must match ^cmp_[a-z0-9_]+$"),
  name: z.string().min(1),
  category: z.enum(["passive", "active", "connector", "mcu", "power", "sensor", "other"]),
  pins: z.array(pinSchema).min(1),
  parameters: z.array(parameterSchema).default([]),
  simModel: simModelSchema.optional(),
  footprint: z.object({ kicadRef: z.string().min(1) }).optional(),
  provenance: provenanceSchema,
});

export type Component = z.infer<typeof componentObjectSchema>;
export type Pin = z.infer<typeof pinSchema>;
export type ComponentParameter = z.infer<typeof parameterSchema>;

export function refineComponent(component: Component, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  component.pins.forEach((pin, index) => {
    if (seen.has(pin.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pins", index, "id"],
        message: `duplicate pin id "${pin.id}"`,
      });
    }
    seen.add(pin.id);
  });

  if (component.simModel) {
    const parameterNames = new Set(component.parameters.map((p) => p.name));
    const derivedParams = component.simModel.derivedParams ?? {};

    // derivedParams shadow nothing: a key colliding with a parameter name is an
    // error, and each expression may reference only declared parameter names,
    // numeric literals, + - * / and parentheses (issue #21).
    for (const [key, expression] of Object.entries(derivedParams)) {
      if (parameterNames.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["simModel", "derivedParams", key],
          message: `derivedParams key "${key}" collides with a declared parameter name`,
        });
        continue;
      }
      const problem = findExpressionProblem(expression, parameterNames);
      if (problem !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["simModel", "derivedParams", key],
          message: `derivedParams expression ${problem}`,
        });
      }
    }

    // Templates may reference {ref}, declared pin ids, declared parameter
    // names, and derivedParams keys (multi-line templates are legal).
    const declared = new Set([
      "ref",
      ...component.pins.map((p) => p.id),
      ...parameterNames,
      ...Object.keys(derivedParams),
    ]);
    for (const match of component.simModel.template.matchAll(/\{([^{}]+)\}/g)) {
      const token = match[1]!;
      if (!declared.has(token)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["simModel", "template"],
          message: `template references undeclared "${token}" (declared: ref, pin ids, parameter names, derivedParams keys)`,
        });
      }
    }
  }
}

export const componentSchema = componentObjectSchema.superRefine(refineComponent);

export function validateComponent(doc: unknown): ValidationResult {
  return runSchema(componentSchema, doc);
}
