/**
 * @openbench/erc — electrical-rule-check engine.
 *
 * Pure function over the schematic IR (`checkSchematic`) that returns typed
 * `Violation`s. No engine, no UI, no IR change — it only reads the schematic
 * and each component's `pin.electricalType`. Consumed by the inspector ERC
 * panel (follow-up) and the AI copilot's "why won't this work?" explanations.
 */
export {
  checkSchematic,
  type ErcResult,
  type Severity,
  type Violation,
} from "./check";
