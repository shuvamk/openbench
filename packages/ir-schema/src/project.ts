import { z } from "zod";
import { idField, irVersionField, provenanceSchema } from "./provenance";
import { runSchema, type ValidationResult } from "./validate";

export const projectObjectSchema = z.object({
  irVersion: irVersionField,
  kind: z.literal("project"),
  id: idField("proj"),
  name: z.string().min(1),
  schematicId: idField("sch").optional(),
  firmwareTargetId: idField("fw").optional(),
  latestSimulationRunId: idField("sim").optional(),
  /** Reserved for Phase 2 (multiplayer) — must accept `[]` today. */
  collaborators: z.array(z.unknown()).default([]),
  provenance: provenanceSchema,
});

export type Project = z.infer<typeof projectObjectSchema>;

export const projectSchema = projectObjectSchema;

export function validateProject(doc: unknown): ValidationResult {
  return runSchema(projectSchema, doc);
}
