import { zodToJsonSchema } from "zod-to-json-schema";
import { irDocumentSchema } from "./document";
import { IR_VERSION } from "./version";

/** JSON Schema dialect the emitted contract declares. */
export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/**
 * Emit the IR as a language-neutral JSON Schema (draft-2020-12), derived from
 * the canonical Zod schemas, so non-TypeScript consumers — MCP agents, CI,
 * third-party tooling — can validate component/schematic/netlist/simulationRun/
 * firmwareTarget/project documents against the same contract without importing
 * TS. The emitter is additive: it never touches the runtime Zod validators,
 * which remain the strict source of truth.
 *
 * The discriminated `kind` union becomes an `anyOf` over the six kinds. What
 * JSON Schema *can* express — required fields, id-prefix patterns, enums,
 * nesting — is carried faithfully; the cross-field refinements (duplicate pin/
 * instance/net ids, template-token checks) are TS-only and are intentionally
 * NOT represented, so a document that passes this schema is structurally valid
 * but should still be run through the Zod validators for full strictness.
 *
 * `zod-to-json-schema` has no draft-2020-12 target; its 2019-09 output is a
 * strict subset of 2020-12 for this IR (no tuples, no `$recursiveRef`), so we
 * emit against 2019-09 and stamp the 2020-12 dialect. `irVersion` is carried
 * at the top level so consumers can pin the contract they validated against.
 */
export function toJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(irDocumentSchema, {
    name: "IrDocument",
    definitionPath: "$defs",
    target: "jsonSchema2019-09",
  }) as Record<string, unknown>;

  return {
    ...schema,
    $schema: JSON_SCHEMA_DIALECT,
    $id: `https://openbench.dev/schemas/ir/v${IR_VERSION}.json`,
    title: "OpenBench IR Document",
    irVersion: IR_VERSION,
  };
}
