# Glossary

Domain terms used consistently across code, issues, and docs. Add terms when an
ambiguity is discovered; agents drift without this.

- **IR** — the OpenBench Interchange Format (`interchange-format.md`). Canonical JSON
  document shapes. "IR document" = one JSON object with `irVersion` + `kind`.
- **Kind** — the discriminator of an IR document: `component`, `schematic`, `netlist`,
  `simulationRun`, `firmwareTarget`, `project`.
- **Component** — a *registry definition* (e.g. "generic resistor"): pins, parameters,
  sim model, footprint ref. Immutable, shared.
- **Instance** — a placed occurrence of a component in a schematic (`R1`, `U1`), with
  parameter overrides. Lives inside a schematic document.
- **Pin** — a connection point on a component (`p1`, `3V3`). `electricalType` follows
  KiCad semantics (passive, input, output, power_in, power_out, bidirectional...).
- **Net** — a set of electrically-connected pins in a schematic, e.g. `net_vcc`.
- **Netlist** — the *derived*, engine-agnostic connectivity document that feeds
  simulators. Never hand-authored; produced by the netlist-compiler.
- **SPICE node** — the numeric node label in a SPICE deck. Ground is always `0`.
- **SPICE card** — one element line in a SPICE deck (`R1 1 0 4700`).
- **Sim model** — the per-component template that expands into a SPICE card.
- **Adapter** — an MCP server wrapping one external engine, implementing
  import/export/validate against the IR.
- **Engine** — external tool we orchestrate: KiCad, ngspice, Renode, QEMU, PlatformIO.
- **Round-trip test** — contract test asserting `import(export(doc)) == doc` modulo
  documented lossy fields.
- **Provenance** — `{ source, at }` stamp on every IR document identifying the
  producing adapter/agent.
- **Registry** — the curated library of component definitions shipped with the app
  (Phase 1: static, in-repo; Phase 2: community submissions via registry-curator).
- **Virtual flash** — flashing firmware to an emulated MCU (Renode/QEMU machine), as
  opposed to physical flash over serial.
- **Red commit / green commit** — the failing-test commit (`test:`) and the
  implementation commit (`feat:/fix:`) of one TDD cycle.
- **The brain** — the `.context/` directory. Read before acting, update after acting.
