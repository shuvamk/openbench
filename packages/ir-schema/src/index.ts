/**
 * @openbench/ir-schema — the canonical OpenBench Interchange Format.
 *
 * Executable twin of .context/interchange-format.md. The spec doc and these
 * schemas must never drift (spec-sync test). All six kinds are implemented:
 * component, schematic, netlist, simulationRun, firmwareTarget, project.
 */
export { IR_VERSION, isSupportedIrVersion } from "./version";
export type { ValidationError, ValidationResult } from "./validate";
export { provenanceSchema, type Provenance } from "./provenance";
export {
  componentSchema,
  validateComponent,
  type Component,
  type ComponentParameter,
  type Education,
  type Pin,
} from "./component";
export {
  schematicSchema,
  validateSchematic,
  type Schematic,
  type SchematicInstance,
  type Net,
  type NetConnection,
  type Probe,
} from "./schematic";
export {
  netlistSchema,
  validateNetlist,
  type Netlist,
  type NetlistNode,
  type NetlistElement,
} from "./netlist";
export {
  simulationRunSchema,
  validateSimulationRun,
  type SimulationRun,
  type WaveformSignal,
} from "./simulation-run";
export {
  firmwareTargetSchema,
  validateFirmwareTarget,
  type FirmwareTarget,
} from "./firmware-target";
export { projectSchema, validateProject, type Project } from "./project";
export type { ProjectBundle } from "./bundle";
export { irDocumentSchema, validateDocument, type IrDocument } from "./document";
export { toJsonSchema, JSON_SCHEMA_DIALECT } from "./json-schema";
