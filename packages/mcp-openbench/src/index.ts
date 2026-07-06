/**
 * @openbench/mcp-openbench — the product-level agent-control surface.
 *
 * The MCP server that lets an external agent (Claude Desktop, Cursor) or the
 * in-app copilot design, wire, compile, simulate and read back a circuit
 * through one coherent tool contract over the IR (spike #33 / ADR-0019,
 * full finding in .context/agent-control-surface.md).
 *
 * The tool handlers are pure, transport-agnostic functions (./tools) so the
 * in-app copilot imports the SAME implementation the external MCP server runs.
 * buildServer() (./server) wraps them for stdio MCP.
 */
export {
  addInstanceTool,
  compileNetlistTool,
  connectTool,
  createProjectTool,
  listRegistryTool,
  readWaveformTool,
  removeInstancesTool,
  runSimulationTool,
  setParamTool,
  validateSchematicTool,
  type DecodedSignal,
  type RegistryEntry,
  type ToolError,
  type ToolResult,
} from "./tools";
export { buildServer, handlers } from "./server";
