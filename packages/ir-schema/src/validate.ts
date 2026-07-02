import type { ZodError, ZodType } from "zod";

/** Structured error shape shared by every adapter (spec §adapter-contract). */
export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function toValidationResult(error: ZodError): ValidationResult {
  return {
    valid: false,
    errors: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function runSchema<T>(schema: ZodType<T>, doc: unknown): ValidationResult {
  const parsed = schema.safeParse(doc);
  return parsed.success ? { valid: true, errors: [] } : toValidationResult(parsed.error);
}
