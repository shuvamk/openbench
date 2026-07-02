#!/usr/bin/env node
/**
 * Stdio bin entry for @openbench/mcp-firmware-platformio
 * (bin: openbench-mcp-firmware-platformio).
 *
 * The MCP server itself lives in ./server.ts (buildServer()), but this repo
 * ships untranspiled TypeScript (package.json "main" points at src/) and no
 * TS loader (tsx/ts-node) or build step is installed, so this entry cannot
 * load it yet. Shipping a transpiled JS bin is a packaging follow-up to
 * issue #20. Once it lands, this file becomes:
 *
 *   import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
 *   import { buildServer } from "../dist/server.js";
 *   await buildServer().connect(new StdioServerTransport());
 */
process.stderr.write(
  "openbench-mcp-firmware-platformio: build step pending — the MCP server (src/server.ts, " +
    "buildServer()) is implemented, but this package ships untranspiled TypeScript and no TS " +
    "loader is installed. TS-transpiled bin distribution is a packaging follow-up to issue #20.\n",
);
process.exit(1);
