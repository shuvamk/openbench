# Deploy Log

> One line per production deploy: date, commit, what changed, any manual-check-worthy
> risk. This is effectively the changelog the human reads instead of reviewing code.
> Appended by the deploy-sanity skill after each production deploy.

| Date (UTC) | Commit | What changed | Risk notes |
| --- | --- | --- | --- |
| 2026-07-02 | add6df0 (working tree, feat/web) | First production deploy: Astryx landing + /api/health. Vercel project `openbench` linked to GitHub (auto-deploy main, previews per PR); SSO protection disabled (public site). URL: https://openbench-eta.vercel.app | Actions billing-locked → deploy was CLI-driven; note openbench.vercel.app belongs to an unrelated pre-existing project, canonical domain is openbench-eta.vercel.app |
| 2026-07-02 | f6b8811 (working tree, feat/phase1) | Phase 1 vertical slice live: /projects dashboard (IndexedDB, templates, import/export), /editor/[projectId] schematic editor (SVG canvas, palette, inspector, wires→IR nets), simulation panel — verified in-browser: real WASM ngspice transient on the RC demo, waveforms rendered, zero console errors. 299 tests green. | Merge to main still gated on GitHub billing fix (ADR-0010); production deployed via CLI from the PR stack head |
| 2026-07-02 | 228a52f (main) | Full stack merged to main (PRs #2,#3,#14→#16; ADR-0012 human-authorized, local gates green). Vercel git integration now owns production deploys. All routes 200. | Required checks disabled until billing fix (issue #15) |
| 2026-07-03 | 22e5c62 (main) | Live mode shipped: interactive circuits (glowing LEDs, motors, buttons/pots re-running WASM ngspice), 17-part registry, undo/redo, KiCad UI, MCP servers, OSS README with real screenshots. 525 tests; gates run locally (ADR-0012). | Live mode is additive; design mode unchanged |
| 2026-07-03 | 5a82b0f (main) | Registry 17→23 parts (PR #32): inductor (R/C/L → RLC), sine/AC voltage source, zener + schottky diodes, PNP transistor, N-channel MOSFET — each fully integrated (SPICE model + symbol glyph + pin geometry + live physics). Reviewer-agent approved all 7 gates; 562 tests. Probed live: / 200 ("OpenBench"), /api/health 200 {ok,irVersion 0.1.0}, /projects 200. | Additive parts only; no IR/compiler change (irVersion unchanged), zero migration risk |
