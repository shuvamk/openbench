# Deploy Log

> One line per production deploy: date, commit, what changed, any manual-check-worthy
> risk. This is effectively the changelog the human reads instead of reviewing code.
> Appended by the deploy-sanity skill after each production deploy.

| Date (UTC) | Commit | What changed | Risk notes |
| --- | --- | --- | --- |
| 2026-07-02 | add6df0 (working tree, feat/web) | First production deploy: Astryx landing + /api/health. Vercel project `openbench` linked to GitHub (auto-deploy main, previews per PR); SSO protection disabled (public site). URL: https://openbench-eta.vercel.app | Actions billing-locked → deploy was CLI-driven; note openbench.vercel.app belongs to an unrelated pre-existing project, canonical domain is openbench-eta.vercel.app |
