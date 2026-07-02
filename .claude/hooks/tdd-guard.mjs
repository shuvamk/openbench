#!/usr/bin/env node
/**
 * PreToolUse hook — mechanical TDD enforcement (ADR-0009).
 *
 * Blocks Write/Edit of product source under apps/ or packages/ unless a test file
 * was created/modified more recently in this session (tracked via a marker file
 * touched whenever a test file is written).
 *
 * Exempt: test files themselves (they refresh the marker), *.md/json/css/svg,
 * config files, type declarations, generated dirs. Escape hatch for emergencies:
 * OPENBENCH_TDD_BYPASS=1 (logged loudly — the reviewer gate still checks the diff).
 *
 * Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
 */
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MARKER = join(projectDir, ".claude", ".tdd-last-test-touch");
const MAX_AGE_MIN = 60;

let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}
let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const tool = payload.tool_name;
if (tool !== "Write" && tool !== "Edit") process.exit(0);

const filePath = payload.tool_input?.file_path;
if (!filePath) process.exit(0);

const rel = relative(projectDir, filePath);
if (rel.startsWith("..")) process.exit(0); // outside repo — not our concern

const isTest =
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)(__tests__|test|tests)\//.test(rel);
const isProductSource =
  /^(apps|packages)\//.test(rel) &&
  /\.[cm]?[jt]sx?$/.test(rel) &&
  !/\.(config|setup)\.[cm]?[jt]s$/.test(rel) &&
  !/\.d\.ts$/.test(rel) &&
  !/(^|\/)(\.next|dist|build|coverage|node_modules)\//.test(rel);

if (isTest) {
  // Test write refreshes the marker — source edits are now allowed for MAX_AGE_MIN.
  try {
    mkdirSync(dirname(MARKER), { recursive: true });
    writeFileSync(MARKER, `${new Date().toISOString()} ${rel}\n`);
  } catch {}
  process.exit(0);
}

if (!isProductSource) process.exit(0);

if (process.env.OPENBENCH_TDD_BYPASS === "1") {
  console.error(`⚠️  TDD guard BYPASSED for ${rel} — the reviewer gate will still audit the diff.`);
  process.exit(0);
}

let markerAgeMin = Infinity;
try {
  markerAgeMin = (Date.now() - statSync(MARKER).mtimeMs) / 60000;
} catch {}

if (markerAgeMin > MAX_AGE_MIN) {
  console.error(
    `TDD guard: blocked ${tool} of ${rel}.\n` +
      (markerAgeMin === Infinity
        ? "No test file has been written this session."
        : `Last test file write was ${Math.round(markerAgeMin)} min ago (limit ${MAX_AGE_MIN}).`) +
      `\nWrite the failing test FIRST (red), confirm it fails for the right reason, then implement.` +
      `\nSee the TDD contract in CLAUDE.md and the tdd-cycle skill.`
  );
  process.exit(2);
}

process.exit(0);
