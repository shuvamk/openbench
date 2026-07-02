---
name: deploy-sanity
description: After a Vercel production deploy, verify the live URL renders and core routes respond; append .context/deploy-log.md. On failure, open a p0 bug and revert main to last good. Run after every production deploy.
---

# deploy-sanity

`main` merges auto-deploy to production, and the human's only feedback loop is the
live site — so every deploy gets verified, and failures roll back immediately.

## Procedure

1. Get the production URL (Vercel project `openbench`; also in the repo variable
   `OPENBENCH_PROD_URL`).
2. Probe:
   - `GET /` → 200, body contains "OpenBench" (marker check, not just status).
   - `GET /api/health` → 200 JSON `{ ok: true, irVersion }`.
   - Editor route `/editor` (or current entry route) → 200.
3. **Healthy** → append one row to `.context/deploy-log.md`:
   `| <UTC date> | <short sha> | <one-line what changed> | <risk notes or —> |`
   and commit it with the next PR (or directly if branch protection allows admin).
4. **Unhealthy** →
   a. `gh issue create --label "type:bug,area:agent-ops,status:ready,p0" --title
      "p0: production unhealthy after <sha>"` with probe output in the body.
   b. Revert: branch `revert/deploy-<sha8>`, `git revert <bad sha>`, push, PR titled
      `revert: unhealthy production deploy (<sha>)` — auto-merge lands it once green.
   c. Append the failure + revert to `deploy-log.md`.
5. Never leave production red while investigating. Revert first, diagnose second.

CI runs the same probe automatically (`deploy-sanity.yml`) on every push to main;
this skill is the richer in-session version (multi-route, log-writing).
