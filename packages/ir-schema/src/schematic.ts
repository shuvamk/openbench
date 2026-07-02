import { z } from "zod";
import { idField, irVersionField, provenanceSchema } from "./provenance";
import { runSchema, type ValidationResult } from "./validate";

const netConnectionSchema = z.object({
  instanceId: z.string().min(1),
  pinId: z.string().min(1),
});

const netSchema = z.object({
  netId: z.string().min(1),
  name: z.string().min(1).optional(),
  connections: z.array(netConnectionSchema),
});

const instanceSchema = z.object({
  instanceId: z.string().min(1),
  componentId: z.string().regex(/^cmp_[a-z0-9_]+$/, "componentId must match ^cmp_[a-z0-9_]+$"),
  parameterOverrides: z
    .record(z.union([z.number(), z.string(), z.boolean()]))
    .optional(),
});

/** Optional editor geometry (additive, issue #5). Keys must be declared instanceIds. */
const layoutSchema = z.object({
  instances: z.record(
    z.object({
      x: z.number(),
      y: z.number(),
      rotation: z
        .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
        .optional(),
    }),
  ),
});

/**
 * Base object shape without cross-field refinements — the discriminated union
 * in ./document composes these and re-applies `refineSchematic`.
 */
export const schematicObjectSchema = z.object({
  irVersion: irVersionField,
  kind: z.literal("schematic"),
  id: idField("sch"),
  projectId: idField("proj"),
  instances: z.array(instanceSchema),
  nets: z.array(netSchema),
  layout: layoutSchema.optional(),
  provenance: provenanceSchema,
});

export type Schematic = z.infer<typeof schematicObjectSchema>;
export type SchematicInstance = z.infer<typeof instanceSchema>;
export type Net = z.infer<typeof netSchema>;
export type NetConnection = z.infer<typeof netConnectionSchema>;

export function refineSchematic(schematic: Schematic, ctx: z.RefinementCtx): void {
  const declaredInstances = new Set<string>();
  schematic.instances.forEach((instance, index) => {
    if (declaredInstances.has(instance.instanceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["instances", index, "instanceId"],
        message: `duplicate instanceId "${instance.instanceId}"`,
      });
    }
    declaredInstances.add(instance.instanceId);
  });

  const seenNetIds = new Set<string>();
  schematic.nets.forEach((net, netIndex) => {
    if (seenNetIds.has(net.netId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nets", netIndex, "netId"],
        message: `duplicate netId "${net.netId}"`,
      });
    }
    seenNetIds.add(net.netId);

    net.connections.forEach((connection, connectionIndex) => {
      if (!declaredInstances.has(connection.instanceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nets", netIndex, "connections", connectionIndex, "instanceId"],
          message: `connection references undeclared instanceId "${connection.instanceId}"`,
        });
      }
    });
  });

  if (schematic.layout) {
    for (const instanceId of Object.keys(schematic.layout.instances)) {
      if (!declaredInstances.has(instanceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layout", "instances", instanceId],
          message: `layout references undeclared instanceId "${instanceId}"`,
        });
      }
    }
  }
}

export const schematicSchema = schematicObjectSchema.superRefine(refineSchematic);

export function validateSchematic(doc: unknown): ValidationResult {
  return runSchema(schematicSchema, doc);
}
