# Deploy Log

> One line per production deploy: date, commit, what changed, any manual-check-worthy
> risk. This is effectively the changelog the human reads instead of reviewing code.
> Appended by the deploy-sanity skill after each production deploy.

| Date (UTC) | Commit | What changed | Risk notes |
| --- | --- | --- | --- |
| 2026-07-02 | add6df0 (working tree, feat/web) | First production deploy: Astryx landing + /api/health. Vercel project `openbench` linked to GitHub (auto-deploy main, previews per PR); SSO protection disabled (public site). URL: https://openbench-eta.vercel.app | Actions billing-locked → deploy was CLI-driven; note openbench.vercel.app belongs to an unrelated pre-existing project, canonical domain is openbench-eta.vercel.app |
| 2026-07-02 | f6b8811 (working tree, feat/phase1) | Phase 1 vertical slice live: /projects dashboard (IndexedDB, templates, import/export), /editor/[projectId] schematic editor (SVG canvas, palette, inspector, wires→IR nets), simulation panel — verified in-browser: real WASM ngspice transient on the RC demo, waveforms rendered, zero console errors. 299 tests green. | Merge to main still gated on GitHub billing fix (ADR-0010); production deployed via CLI from the PR stack head |
