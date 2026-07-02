#!/usr/bin/env node
/**
 * context-freshness — fails CI if architecture-relevant product code changed but
 * .context/ wasn't updated in the same PR (CLAUDE.md: a .context update is part
 * of "done").
 *
 * Architecture-relevant paths (heuristic, tightened over time):
 *   - any package.json (dependency/workspace surface)
 *   - a new or deleted package/app directory
 *   - public API surface: packages/*/src/index.ts
 *   - HTTP surface: apps/web/app/api/**
 *   - pipeline surface: .github/workflows/**, .claude/**
 *
 * Env: BASE_SHA, HEAD_SHA.
 */
import { execSync } from "node:child_process";

const BASE = process.env.BASE_SHA;
const HEAD = process.env.HEAD_SHA || "HEAD";
if (!BASE) {
  console.error("context-freshness: BASE_SHA env var is required");
  process.exit(1);
}

const out = execSync(`git diff --name-status ${BASE}...${HEAD}`, { encoding: "utf8" });
const changed = out
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, ...paths] = line.split("\t");
    return { status: status[0], path: paths[paths.length - 1] };
  });

const files = changed.map((c) => c.path);
const contextTouched = files.some((p) => p.startsWith(".context/"));

const relevant = [];
for (const c of changed) {
  const p = c.path;
  if (/^(apps|packages)\/[^/]+\/package\.json$/.test(p)) relevant.push(`${p} (dependency surface)`);
  if (/^packages\/[^/]+\/src\/index\.[cm]?tsx?$/.test(p)) relevant.push(`${p} (public API surface)`);
  if (/^apps\/web\/(app|src\/app)\/api\//.test(p)) relevant.push(`${p} (HTTP surface)`);
  if (/^\.github\/workflows\//.test(p)) relevant.push(`${p} (pipeline surface)`);
  if ((c.status === "A" || c.status === "D") && /^(apps|packages)\/[^/]+\/(package\.json)$/.test(p))
    relevant.push(`${p} (package added/removed)`);
}

if (relevant.length > 0 && !contextTouched) {
  console.log("context-freshness: FAILED\n");
  console.log("Architecture-relevant paths changed without a .context/ update:\n");
  for (const r of [...new Set(relevant)]) console.log(`  - ${r}`);
  console.log(
    "\nUpdate .context/architecture.md (and engine-status.md / decisions.md as applicable) in this PR."
  );
  process.exit(1);
}

console.log(
  relevant.length === 0
    ? "context-freshness: no architecture-relevant changes."
    : `context-freshness: OK (${relevant.length} relevant change(s), .context/ updated).`
);
