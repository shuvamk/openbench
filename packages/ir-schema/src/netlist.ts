import { z } from "zod";
import { idField, irVersionField, provenanceSchema } from "./provenance";
import { runSchema, type ValidationResult } from "./validate";

const nodeSchema = z.object({
  netId: z.string().min(1),
  spiceNode: z.string().min(1),
});

const elementSchema = z.object({
  instanceId: z.string().min(1),
  spiceCard: z.string().min(1),
});

export const netlistObjectSchema = z.object({
  irVersion: irVersionField,
  kind: z.literal("netlist"),
  id: idField("net"),
  schematicId: idField("sch"),
  nodes: z.array(nodeSchema),
  elements: z.array(elementSchema),
  /** Which compiler derived this netlist (spec: derived, engine-agnostic). Required. */
  derivedBy: z.string().min(1),
  provenance: provenanceSchema,
});

export type Netlist = z.infer<typeof netlistObjectSchema>;
export type NetlistNode = z.infer<typeof nodeSchema>;
export type NetlistElement = z.infer<typeof elementSchema>;

export const netlistSchema = netlistObjectSchema;

export function validateNetlist(doc: unknown): ValidationResult {
  return runSchema(netlistSchema, doc);
}
