---
name: engine-adapter-scaffold
description: Scaffolds a new MCP server wrapping an external engine (KiCad, ngspice, Renode, PlatformIO…) with the standard import/export/validate tool contract, round-trip test harness, and engine-status.md entry. Use when onboarding any new engine.
---

# engine-adapter-scaffold

Every engine gets one package: `packages/mcp-<engine>`, an MCP server speaking IR.

## Layout to generate

```
packages/mcp-<engine>/
├── package.json          # name @openbench/mcp-<engine>, deps: @openbench/ir-schema, @modelcontextprotocol/sdk
├── tsconfig.json         # extends ../../tsconfig.base.json
├── src/
│   ├── index.ts          # public API: importNative, exportNative, validate (pure functions)
│   ├── server.ts         # MCP server registering the tools (thin wrapper over index.ts)
│   └── <engine>/         # engine-specific parsing/serialization
└── test/
    ├── contract.test.ts  # THE round-trip contract: import(export(doc)) toEqual doc
    └── fixtures/         # real native-format samples (checked in, small)
```

## The standard tool contract (non-negotiable)

- `import(nativeFormat) -> IR document(s)` — never throws raw engine errors; returns
  structured `{ ok, documents | errors }`.
- `export(IR document) -> nativeFormat`
- `validate(IR document) -> { valid, errors: [{ path, message }] }` — delegates to
  `@openbench/ir-schema` then adds engine-specific constraints.
- Every produced document is stamped `provenance: { source: "mcp-<engine>", at: ISO }`.

## Order of work (TDD)

1. Red: contract.test.ts with a minimal fixture → commit.
2. Green: parser/serializer until round-trip holds.
3. Lossy fields discovered → document them in `.context/engine-status.md` (same PR;
   the reviewer gate enforces this for `packages/mcp-*` changes).
4. MCP server.ts last — it is a thin adapter over tested pure functions.
5. Update `.context/engine-status.md` status row + `.context/architecture.md` if the
   engine adds a new capability class.
