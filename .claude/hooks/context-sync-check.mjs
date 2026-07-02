#!/usr/bin/env node
/**
 * context-sync check — run post-commit (git hook / PostToolUse) and at session Stop.
 *
 * Compares what changed on the current branch vs main against .context/ updates and
 * prints a checklist of likely-stale brain files. Warn-only (exit 0): the hard gates
 * are context-freshness.yml and the reviewer agent in CI. This hook exists so drift
 * is caught in-session, before a PR ever opens.
 */
import { execSync } from "node:child_process";

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
};

const base = sh("git merge-base main HEAD 2>/dev/null") || sh("git rev-parse HEAD~1 2>/dev/null");
if (!base) process.exit(0);

const files = sh(`git diff --name-only ${base} HEAD`).split("\n").filter(Boolean);
const staged = sh("git diff --name-only --cached").split("\n").filter(Boolean);
const all = [...new Set([...files, ...staged])];
if (all.length === 0) process.exit(0);

const contextTouched = all.filter((f) => f.startsWith(".context/"));
const hints = [];

if (all.some((f) => /^packages\/ir-schema\/src\//.test(f)) && !contextTouched.includes(".context/interchange-format.md"))
  hints.push("IR source changed → .context/interchange-format.md");
if (all.some((f) => /^packages\/mcp-[^/]+\//.test(f)) && !contextTouched.includes(".context/engine-status.md"))
  hints.push("engine adapter changed → .context/engine-status.md");
if (all.some((f) => /^(apps|packages)\/[^/]+\/package\.json$/.test(f)) && !contextTouched.includes(".context/architecture.md"))
  hints.push("package surface changed → .context/architecture.md");
if (all.some((f) => /^\.github\/workflows\//.test(f)) && !contextTouched.includes(".context/architecture.md"))
  hints.push("pipeline changed → .context/architecture.md");

if (hints.length) {
  console.log("🧠 context-sync: possible .context/ drift (CI will enforce):");
  for (const h of hints) console.log(`   - ${h}`);
}
process.exit(0);
