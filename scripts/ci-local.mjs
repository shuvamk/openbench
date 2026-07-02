#!/usr/bin/env node
/**
 * ci-local — local pipeline runner (ADR-0010).
 *
 * GitHub Actions is unavailable (account billing lock), so this script runs the
 * EXACT same gates the workflows would run — test suite, reviewer-agent
 * (.github/scripts/reviewer-check.mjs), context-freshness — against a PR head,
 * and posts the results as commit statuses with the same required contexts
 * (`test`, `reviewer-agent`, `context-freshness`). Branch protection therefore
 * keeps gating merges; hosted Actions take over automatically once unlocked.
 *
 * Usage: node scripts/ci-local.mjs <pr-number>
 */
import { execSync, spawnSync } from "node:child_process";

const pr = process.argv[2];
if (!pr) {
  console.error("usage: node scripts/ci-local.mjs <pr-number>");
  process.exit(1);
}

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const repo = sh("gh repo view --json nameWithOwner --jq .nameWithOwner");
const prInfo = JSON.parse(
  sh(`gh pr view ${pr} --json headRefOid,baseRefName,title,headRefName`)
);
const HEAD = prInfo.headRefOid;
const BASE = sh(`git merge-base origin/${prInfo.baseRefName} ${HEAD}`);

console.log(`ci-local: ${repo} PR #${pr} (${prInfo.headRefName})`);
console.log(`  head=${HEAD}\n  base=${BASE}\n`);

const postStatus = (context, state, description) => {
  execSync(
    `gh api repos/${repo}/statuses/${HEAD} -f state=${state} -f context=${context} ` +
      `-f description=${JSON.stringify(description.slice(0, 130))}`,
    { stdio: "pipe" }
  );
  console.log(`  status: ${context} → ${state}`);
};

const gates = [
  {
    context: "test",
    run: () => spawnSync("npm", ["test"], { stdio: "inherit", encoding: "utf8" }),
    desc: "full test suite (local runner)",
  },
  {
    context: "reviewer-agent",
    run: () =>
      spawnSync("node", [".github/scripts/reviewer-check.mjs"], {
        stdio: "inherit",
        encoding: "utf8",
        env: { ...process.env, BASE_SHA: BASE, HEAD_SHA: HEAD, PR_TITLE: prInfo.title },
      }),
    desc: "mechanical adversarial review (local runner)",
  },
  {
    context: "context-freshness",
    run: () =>
      spawnSync("node", [".github/scripts/context-freshness.mjs"], {
        stdio: "inherit",
        encoding: "utf8",
        env: { ...process.env, BASE_SHA: BASE, HEAD_SHA: HEAD },
      }),
    desc: ".context/ freshness (local runner)",
  },
];

let allGreen = true;
for (const gate of gates) {
  console.log(`\n=== gate: ${gate.context} ===`);
  postStatus(gate.context, "pending", gate.desc);
  const result = gate.run();
  const ok = result.status === 0;
  allGreen &&= ok;
  postStatus(gate.context, ok ? "success" : "failure", gate.desc);
}

console.log(`\nci-local: ${allGreen ? "ALL GREEN" : "RED — fix and re-run"}`);
process.exit(allGreen ? 0 : 1);
