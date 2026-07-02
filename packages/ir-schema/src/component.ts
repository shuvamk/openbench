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
  template: z.string().min(1),
  /** Optional SPICE `.model` card emitted alongside the template (additive, issue #5). */
  modelCard: z.string().min(1).optional(),
});

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
    // Templates may reference {ref}, declared pin ids, and declared parameter names.
    const declared = new Set([
      "ref",
      ...component.pins.map((p) => p.id),
      ...component.parameters.map((p) => p.name),
    ]);
    for (const match of component.simModel.template.matchAll(/\{([^{}]+)\}/g)) {
      const token = match[1]!;
      if (!declared.has(token)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["simModel", "template"],
          message: `template references undeclared "${token}" (declared: ref, pin ids, parameter names)`,
        });
      }
    }
  }
}

export const componentSchema = componentObjectSchema.superRefine(refineComponent);

export function validateComponent(doc: unknown): ValidationResult {
  return runSchema(componentSchema, doc);
}
