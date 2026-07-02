import { z } from "zod";
import { isSupportedIrVersion, IR_VERSION } from "./version";

/**
 * Shared fields every IR document carries (spec §principles: versioned +
 * traceable provenance). Reused by all six document kinds.
 */
export const irVersionField = z.string().refine(isSupportedIrVersion, {
  message: `unsupported irVersion (current: ${IR_VERSION}; pre-1.0, major.minor must match)`,
});

export const provenanceSchema = z.object({
  source: z.string().min(1),
  at: z.string().datetime({ offset: true }),
  addedBy: z.string().min(1).optional(),
});

export type Provenance = z.infer<typeof provenanceSchema>;

/** ID prefixes per IR spec (`cmp_`/`sch_`/`net_`/`sim_`/`fw_`/`proj_`). */
export const idPattern = (prefix: string): RegExp => new RegExp(`^${prefix}_[a-z0-9_-]+$`);

export const idField = (prefix: string) =>
  z.string().regex(idPattern(prefix), `ids must match ^${prefix}_[a-z0-9_-]+$`);
