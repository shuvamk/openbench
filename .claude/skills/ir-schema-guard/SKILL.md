---
name: ir-schema-guard
description: Validates any interchange-format (IR) change against .context/interchange-format.md and all engine adapters. Use BEFORE merging any change to packages/ir-schema or the IR doc. Flags breaking changes and forces version bumps.
---

# ir-schema-guard

The IR is the constitution of this repo. Any change is a breaking-change candidate.

## Checklist (run every item; all must pass)

1. **Spec ↔ code sync.** `.context/interchange-format.md` and `packages/ir-schema/src`
   must describe the same shapes. Run `npm run test -w packages/ir-schema` — the
   `spec-sync` tests parse the documented examples with the live schemas.
2. **Classify the change.**
   - *Additive* (new optional field, new enum value consumed nowhere yet): patch bump.
   - *Breaking* (rename, remove, retype, new REQUIRED field, semantics change):
     pre-1.0 → minor bump of `IR_VERSION`; post-1.0 → major.
3. **Blast radius.** Grep every adapter (`packages/mcp-*`, `packages/netlist-compiler`,
   `apps/web`) for the touched field/kind. Every consumer updates in the SAME PR — the
   IR never merges ahead of its consumers.
4. **Round-trips still hold.** All adapter contract tests
   (`import(export(doc)) == doc`) green. Newly-lossy fields → documented in
   `.context/engine-status.md` in the same PR.
5. **Docs.** Update `.context/interchange-format.md` (schemas + changelog note) and
   append an ADR to `.context/decisions.md` if the change resolves an open item.
6. **Migration.** Breaking change → `migrate(doc, fromVersion)` support in
   `packages/ir-schema` so stored documents keep loading, with a test per migration.

## Hard stops

- Deleting a document kind, the `irVersion` field, or `provenance` → this is
  status:needs-design territory. Do not proceed autonomously.
