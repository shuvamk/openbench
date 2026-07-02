import { z } from "zod";
import { idField, irVersionField, provenanceSchema } from "./provenance";
import { runSchema, type ValidationResult } from "./validate";

const flashTargetSchema = z.object({
  kind: z.enum(["virtual", "physical"]),
  engine: z.enum(["renode", "qemu"]),
  machineConfig: z.string().min(1).optional(),
});

export const firmwareTargetObjectSchema = z.object({
  irVersion: irVersionField,
  kind: z.literal("firmwareTarget"),
  id: idField("fw"),
  projectId: idField("proj"),
  mcu: z.string().min(1),
  framework: z.enum(["arduino", "esp-idf", "zephyr"]),
  sourceRef: z.string().min(1),
  buildStatus: z.enum(["pending", "building", "success", "failed"]),
  /** Absent until a build succeeds. */
  artifact: z
    .object({
      binary: z.string().min(1).optional(),
      elf: z.string().min(1).optional(),
    })
    .optional(),
  flashTarget: flashTargetSchema,
  provenance: provenanceSchema,
});

export type FirmwareTarget = z.infer<typeof firmwareTargetObjectSchema>;

export const firmwareTargetSchema = firmwareTargetObjectSchema;

export function validateFirmwareTarget(doc: unknown): ValidationResult {
  return runSchema(firmwareTargetSchema, doc);
}
