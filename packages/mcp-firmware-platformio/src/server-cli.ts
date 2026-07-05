/**
 * Stdio bin entry for @openbench/mcp-firmware-platformio (bin: openbench-mcp-firmware-platformio).
 *
 * Bundled to dist/server-cli.js by `npm run build` (build.mjs) and wired to the
 * MCP StdioServerTransport, so `npx @openbench/mcp-firmware-platformio` speaks MCP over stdio.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

await buildServer().connect(new StdioServerTransport());
