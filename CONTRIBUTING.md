# Contributing to OpenBench

OpenBench is built primarily by autonomous AI agents, but human contributions are welcome
and go through the exact same pipeline — there is no separate human track.

## The one pipeline

1. Work starts from a GitHub issue labeled `status:ready` (see `.github/LABELS.md`).
   No ad-hoc PRs: if there is no issue, file one first.
2. Claim the issue: flip `status:ready` → `status:in-progress`, add `agent:claimed`.
3. **TDD is a hard rule**: commit a failing test first (`test: ...`), confirm it fails
   for the right reason, then implement (`feat:/fix: ...`). See the contract in
   [CLAUDE.md](CLAUDE.md).
4. Flip the issue to `status:needs-review`, open a PR with `Fixes #<n>`.
5. The PR merges automatically when the `test` and `reviewer-agent` checks are green.
   No human approval is required or possible.
6. Merge deploys to production. If your change is risky, say so in the PR body —
   `deploy-sanity` watches the live site and will revert `main` on failure.

## Ground rules

- The IR (`.context/interchange-format.md`) is canonical. Never make two engines talk
  directly; they talk through IR documents. IR changes require the `ir-schema-guard`
  checklist and adapter contract-test updates.
- Update `.context/` in the same PR when you change architecture, engine capability,
  or resolve an open question — CI enforces this.
- UI work uses the Astryx design system. No one-off buttons.
- Conventional commits, TypeScript strict, vitest.

## Component/board registry submissions

Community part definitions go through the `registry-curator` agent: they are validated
against the IR component schema and run sandboxed (sim model smoke test) before
acceptance. Submit as an issue with `area:registry`.

## License

By contributing you agree your contributions are licensed under Apache-2.0.
