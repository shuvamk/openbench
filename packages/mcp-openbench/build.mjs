import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bundle the stdio bin (parity with issue #20/#31 adapter servers). The
 * @openbench/* workspace deps ship as untranspiled TypeScript (dual-env,
 * ADR-0006), so a plain `tsc` dist would still `import "@openbench/ir-schema"`
 * → TS at runtime. esbuild bundles those workspace deps into one runnable ESM
 * file while keeping the real npm deps (the MCP SDK, zod) external — they
 * resolve from node_modules at run time.
 */
const EXTERNAL = ["@modelcontextprotocol/sdk", "zod", "eecircuit-engine"];

export function distEntry(cwd = process.cwd()) {
  return resolve(cwd, "dist/server-cli.js");
}

export async function buildCli(cwd = process.cwd()) {
  await build({
    absWorkingDir: cwd,
    entryPoints: ["src/server-cli.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: "dist/server-cli.js",
    external: EXTERNAL,
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "warning",
  });
}

// Support `node build.mjs` as the package's npm "build" script.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
