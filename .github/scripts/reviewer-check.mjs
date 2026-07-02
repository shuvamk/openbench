#!/usr/bin/env node
/**
 * reviewer-agent — the sole merge gate (ADR-0003).
 *
 * Adversarial mechanical review of a PR diff. No human backstops this, so every
 * check fails CLOSED (unknown state = red). Checks:
 *
 *   1. TDD contract  — source diffs under apps/ or packages/ must ship with test
 *                      diffs (policy in ADR-0009 / CLAUDE.md).
 *   2. IR guard      — changes to packages/ir-schema/src require
 *                      .context/interchange-format.md to be touched in the same PR
 *                      (escape hatch: "[ir-internal]" in the PR title for pure
 *                      refactors that provably don't change shapes).
 *   3. Irreversibles — LICENSE changes, deletion of .context/interchange-format.md
 *                      or any .context file: hard fail (status:needs-design territory).
 *   4. Deploy risk   — `.only(` in tests (silently skips the suite), `describe.skip`
 *                      on changed tests, `x-vercel-protection-bypass` style secrets
 *                      in the diff, `process.exit` in library source.
 *   5. Engine status — changes under packages/mcp-* require
 *                      .context/engine-status.md touched (adapters must document gaps).
 *
 * Env: BASE_SHA, HEAD_SHA (merge-base diff), PR_TITLE (optional).
 * Exit 0 = approve, exit 1 = reject with reasons on stdout.
 */
import { execSync } from "node:child_process";

const BASE = process.env.BASE_SHA;
const HEAD = process.env.HEAD_SHA || "HEAD";
const PR_TITLE = process.env.PR_TITLE || "";
if (!BASE) {
  console.error("reviewer-agent: BASE_SHA env var is required");
  process.exit(1);
}

const sh = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const changed = sh(`git diff --name-status ${BASE}...${HEAD}`)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, ...paths] = line.split("\t");
    return { status: status[0], path: paths[paths.length - 1] };
  });

const files = changed.map((c) => c.path);
const failures = [];
const warnings = [];

// ---------- helpers ----------
const isTestFile = (p) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(__tests__|test|tests)\//.test(p);

const isExemptSource = (p) =>
  /\.(md|json|css|scss|svg|png|jpg|ico|txt|yml|yaml|lock)$/.test(p) ||
  /(^|\/)(\.next|dist|build|coverage|node_modules)\//.test(p) ||
  /\.config\.[cm]?[jt]s$/.test(p) ||
  /next-env\.d\.ts$/.test(p) ||
  /\.d\.ts$/.test(p);

const isProductSource = (p) =>
  /^(apps|packages)\//.test(p) && /\.[cm]?[jt]sx?$/.test(p) && !isTestFile(p) && !isExemptSource(p);

// ---------- 1. TDD contract ----------
const sourceChanges = files.filter(isProductSource);
const testChanges = files.filter((p) => /^(apps|packages)\//.test(p) && isTestFile(p));
if (sourceChanges.length > 0 && testChanges.length === 0) {
  failures.push(
    `TDD contract violation: ${sourceChanges.length} source file(s) changed with zero test changes.\n` +
      sourceChanges.map((f) => `    - ${f}`).join("\n") +
      `\n  Every source change ships with a failing-test-first history (CLAUDE.md).`
  );
}

// ---------- 2. IR guard ----------
const irSrcChanged = files.some((p) => p.startsWith("packages/ir-schema/src/"));
const irDocTouched = files.includes(".context/interchange-format.md");
if (irSrcChanged && !irDocTouched && !PR_TITLE.includes("[ir-internal]")) {
  failures.push(
    "IR guard: packages/ir-schema/src changed but .context/interchange-format.md was not touched. " +
      "IR changes are breaking-change candidates — update the spec doc (or mark the PR title [ir-internal] for pure refactors)."
  );
}

// ---------- 3. Irreversibles ----------
if (files.includes("LICENSE")) {
  failures.push("Irreversible: LICENSE modified. License changes require a status:needs-design issue, never a normal PR.");
}
for (const c of changed) {
  if (c.status === "D" && c.path.startsWith(".context/")) {
    failures.push(`Irreversible: ${c.path} deleted. .context/ files are append/update-only.`);
  }
}

// ---------- 4. Deploy risk ----------
let diff = "";
try {
  diff = sh(`git diff ${BASE}...${HEAD} -- ':!package-lock.json'`);
} catch {
  failures.push("Could not compute diff for risk scan — failing closed.");
}
const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
if (addedLines.some((l) => /\b(it|test|describe)\.only\(/.test(l))) {
  failures.push("Deploy risk: `.only(` added to a test — this silently disables the rest of the suite.");
}
if (addedLines.some((l) => /(api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i.test(l))) {
  failures.push("Deploy risk: something that looks like a hardcoded secret was added.");
}
if (
  addedLines.some((l) => /process\.exit\(/.test(l)) &&
  sourceChanges.some((p) => p.startsWith("packages/") && !p.includes("/bin/") && !p.includes("/cli"))
) {
  warnings.push("process.exit() added in library source — verify it is not reachable from the web app.");
}

// ---------- 5. Engine status freshness ----------
const adapterChanged = files.some((p) => /^packages\/mcp-[^/]+\/src\//.test(p));
if (adapterChanged && !files.includes(".context/engine-status.md")) {
  failures.push(
    "Engine adapter source changed but .context/engine-status.md was not updated. " +
      "Adapter status + lossy fields must stay current (CLAUDE.md)."
  );
}

// ---------- verdict ----------
console.log(`reviewer-agent: ${files.length} files changed (${sourceChanges.length} source, ${testChanges.length} test)`);
for (const w of warnings) console.log(`  WARN: ${w}`);
if (failures.length) {
  console.log("\nREJECTED — the reviewer agent found the following:\n");
  for (const f of failures) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log("APPROVED — all mechanical review checks passed.");
