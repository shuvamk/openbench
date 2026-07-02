import { z } from "zod";
import { idField, irVersionField, provenanceSchema } from "./provenance";
import { runSchema, type ValidationResult } from "./validate";

/** Samples live out-of-band: any URI with a scheme (s3://, https://, file://) or a data: URI. */
const URI_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:.+$/i;

const waveformSignalSchema = z.object({
  netId: z.string().min(1),
  unit: z.string().min(1),
  samples: z
    .string()
    .regex(URI_WITH_SCHEME, "samples must be a URL or data: URI"),
});

const resultsSchema = z.object({
  format: z.literal("waveform-v1"),
  signals: z.array(waveformSignalSchema),
});

export const simulationRunObjectSchema = z.object({
  irVersion: irVersionField,
  kind: z.literal("simulationRun"),
  id: idField("sim"),
  netlistId: idField("net"),
  engine: z.enum(["ngspice", "renode", "qemu"]),
  /** Engine-specific mode (e.g. "transient"); documented per adapter. */
  mode: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  results: resultsSchema.optional(),
  logs: z.string().optional(),
  provenance: provenanceSchema,
});

export type SimulationRun = z.infer<typeof simulationRunObjectSchema>;
export type WaveformSignal = z.infer<typeof waveformSignalSchema>;

export const simulationRunSchema = simulationRunObjectSchema;

export function validateSimulationRun(doc: unknown): ValidationResult {
  return runSchema(simulationRunSchema, doc);
}
