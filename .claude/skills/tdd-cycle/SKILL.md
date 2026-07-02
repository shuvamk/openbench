---
name: tdd-cycle
description: Enforces red→green→refactor for any implementation work. Use before writing or modifying any source file under apps/ or packages/. Refuses to let implementation code be written without a failing test shown first.
---

# tdd-cycle

The TDD contract (CLAUDE.md) is a hard rule: **no source file is created or modified
without a failing test committed first, in the same or a preceding commit.**

## The cycle

1. **Red.** From the issue's acceptance criteria, write the smallest test that captures
   the next behavior. Run it: `npm run test -w <package> -- --run <file>`.
   - It must FAIL, and fail **for the right reason** — an assertion about missing
     behavior, not a typo/import error you didn't intend. Read the failure output and
     say in one line why this is the right failure.
   - Commit: `test: <behavior> (red)` — this commit contains ONLY test changes.
2. **Green.** Write the *minimal* implementation that passes. Run the test. Run the
   whole package suite. Commit: `feat|fix: <behavior>`.
3. **Refactor.** With green as a safety net, remove duplication, tighten names/types.
   Suite stays green. Commit: `refactor: …` (only if you actually refactored).

## Refusals (do not proceed if…)

- You are about to Write/Edit product source and cannot point to the failing test run
  output from this session → **stop, write the test.** (The tdd-guard hook blocks this
  mechanically; do not bypass it.)
- The test passes on first run → it isn't testing the new behavior. Fix the test.
- The test fails for the wrong reason (bad import, syntax) → fix the test until the
  failure is the behavioral assertion.

## Evidence

The PR body must cite the red commit sha and the green commit sha (PR template). The
reviewer gate rejects source diffs that ship without test diffs.
