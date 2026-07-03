/**
 * @openbench/netlist-compiler — schematic IR → engine-agnostic netlist IR.
 *
 * Pure function of its inputs: component resolution is injected so the package
 * stays decoupled from the registry, and timestamps/ids are overridable for
 * deterministic output.
 */
export {
  compileNetlist,
  COMPILER_ID,
  type CompileError,
  type CompileNetlistOptions,
  type CompileNetlistResult,
} from "./compile";
export { evaluateExpression, type EvaluateResult } from "./expr";
