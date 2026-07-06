/**
 * Stdio bin entry for @openbench/mcp-openbench (bin: openbench-mcp-openbench).
 *
 * Bundled to dist/server-cli.js by `npm run build` (build.mjs) and wired to the
 * MCP StdioServerTransport, so `npx @openbench/mcp-openbench` speaks the
 * agent-control tool surface over stdio.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

await buildServer().connect(new StdioServerTransport());
