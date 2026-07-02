import { z } from "zod";
import { componentObjectSchema, refineComponent } from "./component";
import { firmwareTargetObjectSchema } from "./firmware-target";
import { netlistObjectSchema } from "./netlist";
import { projectObjectSchema } from "./project";
import { refineSchematic, schematicObjectSchema } from "./schematic";
import { simulationRunObjectSchema } from "./simulation-run";
import { runSchema, type ValidationResult } from "./validate";

/**
 * Every IR document, discriminated on `kind` (spec §core-schemas). The
 * kind-specific cross-field refinements (duplicate pin/instance/net ids,
 * template token checks, layout keys) run here too, so parsing through the
 * union is exactly as strict as the per-kind validators.
 */
export const irDocumentSchema = z
  .discriminatedUnion("kind", [
    componentObjectSchema,
    schematicObjectSchema,
    netlistObjectSchema,
    simulationRunObjectSchema,
    firmwareTargetObjectSchema,
    projectObjectSchema,
  ])
  .superRefine((doc, ctx) => {
    if (doc.kind === "component") refineComponent(doc, ctx);
    else if (doc.kind === "schematic") refineSchematic(doc, ctx);
  });

export type IrDocument = z.infer<typeof irDocumentSchema>;

/** Adapter-contract validate: dispatches on `kind`; unknown kinds error at path "kind". */
export function validateDocument(doc: unknown): ValidationResult {
  return runSchema(irDocumentSchema, doc);
}
