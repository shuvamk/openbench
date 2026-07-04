# Agent-control MCP surface — `packages/mcp-openbench` (spike #33)

> Design finding for the **product-level** agent surface: the MCP server that lets an
> external agent (Claude Desktop, Cursor, our in-app copilot) design, wire, compile,
> simulate, and read back a circuit through one coherent tool contract. Output of the
> time-boxed spike issue #33; the implementation issue depends on this. Decisions are
> recorded as **ADR-0019** in [decisions.md](decisions.md); this file is the full finding.

## 1. Problem

The engine adapters (`mcp-kicad`, `mcp-sim-ngspice`, `mcp-firmware-platformio`) each wrap
one engine behind `import`/`export`/`validate` + engine-specific tools. They are the wrong
altitude for an agent: to turn *"design me an RC low-pass and show me the step response"*
into a result, an agent would have to know the netlist compiler's call signature, the
registry's component ids, the ngspice deck config, and how to thread an IR document through
all three. There is **no product-level tool surface** that speaks in circuit-authoring
verbs (`add a resistor`, `wire these pins`, `run a transient`) and hides the IR plumbing.

`packages/mcp-openbench` is that surface. It maps authoring verbs onto the **existing pure
functions** — `apps/web/lib/editor/mutations.ts` (schematic edits), `netlist-compiler`
(schematic → netlist), `erc` (`checkSchematic`), `mcp-sim-ngspice`'s `runSimulation`, and
`ir-schema`'s validators. **It introduces no new engine logic.**

## 2. State model — **stateless per call, project-doc-in / project-doc-out**

**Decision: stateless.** Every tool takes the current `project`/`schematic` IR document as
an argument and returns the mutated document (plus any derived result). The server holds no
per-agent session, no in-memory project map, no lease.

Why:

- **The IR is already the source of truth** (CLAUDE.md: "treating any engine-native format
  as source of truth" is a non-goal; the IR is canonical). Mutations are already pure
  `Schematic → Schematic` functions. A stateless surface is a direct exposure of that
  shape; a stateful one would bolt a second, divergent copy of project state onto the MCP
  process and immediately raise "who wins when the canvas and the agent both edit?"
- **Matches the existing adapters.** `mcp-sim-ngspice`'s `run_simulation` already takes the
  full `netlist` in the call and returns the full `simulationRun` — never throws, no session
  (`server.ts`). Staying stateless keeps the whole MCP fleet consistent.
- **Concurrency & crash-safety for free.** No server-side mutable state means two agents (or
  an agent + the canvas) never corrupt a shared object; a restarted server loses nothing.
- **The in-app copilot already owns the store.** In `apps/web` the live project lives in the
  zustand document store. The copilot passes `store.getState().schematic` in and applies the
  returned doc via the same store setter the canvas uses — one writer, no second authority.

Cost accepted: the caller re-sends the document each turn (larger payloads; the agent must
thread the returned doc into the next call). For Phase-1 project sizes (tens of instances)
this is negligible, and it is the same trade the sim adapter already makes. A convenience
**session cache is explicitly deferred** — if payload size ever bites, a thin optional
`projectId → doc` cache can be layered *on top* without changing any tool's IR contract
(the doc argument stays authoritative; the cache is a lookup shortcut). We do not build it
now (YAGNI; it reintroduces the divergence problem the moment it exists).

## 3. Shared mutation layer — **extract `packages/schematic-ops`**

Today the pure authoring functions (`placeInstance`, `moveInstance`, `rotateInstance`,
`connectPins`, `deleteSelection`, `setParameterOverride`, `snapToGrid`, `refPrefix`) live in
`apps/web/lib/editor/mutations.ts`. They are already pure IR-in/IR-out with **zero React /
Next.js dependency** — but they physically sit inside the web app, so an MCP server (which
must not depend on `apps/web`) cannot import them without pulling the app into its build.

**Decision: extract them verbatim into a new headless package `packages/schematic-ops`**,
depending only on `@openbench/ir-schema`. `apps/web/lib/editor/mutations.ts` becomes a
re-export shim (`export * from "@openbench/schematic-ops"`) so the editor, the copilot, and
the external MCP server all call **one** implementation. This is the load-bearing decision
of the spike: it guarantees the in-app copilot and the external agent can never drift.

Why a package rather than "MCP imports from apps/web":

- `packages/*` is the established home for engine-free pure logic (`netlist-compiler`,
  `erc`, `ir-schema` all follow this). `apps/web` is a deployable, not a library.
- Keeps the MCP server's dependency graph clean (`ir-schema` + `schematic-ops` + the three
  derivation/sim packages — no Next.js).
- The extraction is mechanical and **behaviour-preserving**, so it is TDD-cheap: move the
  file, point the existing `mutations.test.ts` at the new package, prove green, then add the
  shim. No behaviour changes ride along.

The MCP tool handlers are then a **thin translation shell**: parse args → validate IR →
call the shared op → return `{ ok, ... }`. No business logic in the server.

```
                 packages/schematic-ops  (NEW — pure Schematic→Schematic)
                   ▲                    ▲
   apps/web/lib/editor/mutations.ts     packages/mcp-openbench
   (re-export shim; canvas + copilot)   (external MCP server)
                   ▲                             │ also calls ▼
            zustand document store        netlist-compiler · erc · mcp-sim-ngspice · ir-schema
```

## 4. Error shape — structured, never-throw, adapter-consistent

Every tool returns the repo's established discriminated result, identical to the netlist
compiler (`CompileNetlistResult`) and the ngspice server (`structuredFailure`):

```ts
type ToolResult<T> =
  | { ok: true;  data: T;               warnings?: string[] }
  | { ok: false; errors: { path: string; message: string }[] };
```

- **Never throws across the tool boundary.** Bad input (unknown componentId, dangling
  pinRef, malformed doc, unknown probe) is a collected `{ path, message }` entry, never an
  exception — the exact contract `runSimulation` and `compileNetlist` already honour.
- **Validation is layered:** every tool first runs `validate(doc)` from `ir-schema`; a
  structurally invalid document short-circuits to `{ ok: false, errors }` before any op runs.
- `warnings` carries non-fatal derivation notes (e.g. compiler warnings, ERC advisories on a
  `run_simulation` that still produced a deck).

## 5. Tool surface

Nine tools, grouped author → derive → inspect. Every `schematic`/`project`/`netlist` field
below is the corresponding **IR document** as defined in
[interchange-format.md](interchange-format.md); ids use the spec prefixes
(`cmp_`/`sch_`/`net_`/`sim_`/`proj_`).

### Authoring (map to `schematic-ops`)

| Tool | Input | Output (`data`) | Backed by |
| --- | --- | --- | --- |
| `create_project` | `{ name: string }` | `{ project }` (empty `schematic` + metadata) | new thin factory in `schematic-ops` |
| `list_registry` | `{ query?: string }` | `{ components: {id,name,category,pins,parameters}[] }` | `registry` (`registryComponents`, `getComponent`) |
| `add_instance` | `{ schematic, componentId, position?, params? }` | `{ schematic, instanceId }` | `placeInstance` (+ `setParameterOverride` per param) |
| `connect` | `{ schematic, pinRefs: {instanceId,pinId}[] }` | `{ schematic, netId }` | `connectPins` folded pairwise over `pinRefs` |
| `set_param` | `{ schematic, instanceId, name, value }` | `{ schematic }` | `setParameterOverride` |
| `remove_instances` | `{ schematic, instanceIds: string[] }` | `{ schematic }` | `deleteSelection` |

Notes:
- `add_instance` resolves `componentId` against the registry first; unknown id →
  `{ ok:false, errors:[{path:"componentId", …}] }`. `position` defaults to an
  auto-placed grid slot so an agent that doesn't care about layout can omit it.
- `connect` takes **N pin refs** (agents think "these three pins are one net"); it folds
  `connectPins(a,b)` pairwise, reusing its merge/loose-pin logic so the whole set lands on
  one net. Returns the surviving `netId`.

### Derivation

| Tool | Input | Output (`data`) | Backed by |
| --- | --- | --- | --- |
| `validate_schematic` | `{ schematic }` | `{ valid, irErrors, ercViolations }` | `ir-schema` `validate` + `erc` `checkSchematic` (registry resolver injected) |
| `compile_netlist` | `{ schematic }` | `{ netlist }` | `netlist-compiler` `compileNetlist` |
| `run_simulation` | `{ schematic \| netlist, mode:"transient", config:{duration,step,probes?} }` | `{ simulationRun }` | compiles if given a schematic, then `mcp-sim-ngspice` `runSimulation` (MockBackend Phase-1) |

`validate_schematic` is the agent's cheap pre-flight: it fuses structural IR validation with
ERC so the agent gets "why won't this work?" (`ERC_NO_GROUND`, `ERC_FLOATING_PIN`, …) before
paying for a sim run — exactly the copilot use `packages/erc` was built for.

### Inspection

| Tool | Input | Output (`data`) | Backed by |
| --- | --- | --- | --- |
| `read_waveform` | `{ simulationRun, signal? }` | `{ signals: {netId, unit, t:number[], v:number[]}[] }` | decode `simulationRun` samples (`decodeSamples`) |

`read_waveform` decodes the base64 `Float64Array` samples in the `simulationRun` IR into
plain `t`/`v` arrays an agent can reason over (or feed to a plotting tool); `signal` filters
to one net. `get_schematic` is intentionally **not** a tool — the schematic is stateless and
already in the agent's hands (it passed it in). If we later add the session cache (§2), a
`get_schematic(projectId)` read tool slots in then.

## 6. Worked example — RC low-pass step response

The transcript below builds a series-R / shunt-C low-pass driven by a pulse source and reads
the step response. Each block is one tool call; the agent threads `data.schematic` from each
result into the next call (stateless, §2). Registry ids are the real Phase-1 parts
(`resistorGeneric`→`cmp_r`, `capacitorGeneric`→`cmp_c`, `vsourcePulse`→`cmp_vpulse`,
`ground`→`cmp_ground` — see `packages/registry`).

```jsonc
// 1. Start a project.
→ create_project { "name": "RC low-pass" }
← { ok:true, data:{ project:{ id:"proj_rc1", schematic:{ id:"sch_rc1", instances:[], nets:[] }, … } } }

// 2. What can I place? (agent discovers registry ids.)
→ list_registry { "query":"resistor" }
← { ok:true, data:{ components:[{ id:"cmp_r", name:"Resistor", pins:["1","2"], parameters:[{name:"resistance",…}] }] } }

// 3. Place the four parts (position omitted → auto grid slot).
→ add_instance { schematic, componentId:"cmp_vpulse", params:{ v1:"0", v2:"1", td:"0", tr:"1u", pw:"5m", per:"10m" } }
← { ok:true, data:{ schematic:<S1>, instanceId:"V1" } }
→ add_instance { schematic:<S1>, componentId:"cmp_r", params:{ resistance:"1k" } }
← { ok:true, data:{ schematic:<S2>, instanceId:"R1" } }
→ add_instance { schematic:<S2>, componentId:"cmp_c", params:{ capacitance:"1u" } }
← { ok:true, data:{ schematic:<S3>, instanceId:"C1" } }
→ add_instance { schematic:<S3>, componentId:"cmp_ground" }
← { ok:true, data:{ schematic:<S4>, instanceId:"GND1" } }

// 4. Wire it: V1.+ → R1.1 (input), R1.2 → C1.1 (output node "vout"), C1.2 & V1.- → ground.
→ connect { schematic:<S4>, pinRefs:[{instanceId:"V1",pinId:"+"},{instanceId:"R1",pinId:"1"}] }
← { ok:true, data:{ schematic:<S5>, netId:"net_in" } }
→ connect { schematic:<S5>, pinRefs:[{instanceId:"R1",pinId:"2"},{instanceId:"C1",pinId:"1"}] }
← { ok:true, data:{ schematic:<S6>, netId:"net_vout" } }
→ connect { schematic:<S6>, pinRefs:[{instanceId:"C1",pinId:"2"},{instanceId:"V1",pinId:"-"},{instanceId:"GND1",pinId:"1"}] }
← { ok:true, data:{ schematic:<S7>, netId:"net_gnd" } }

// 5. Pre-flight before spending a sim run.
→ validate_schematic { schematic:<S7> }
← { ok:true, data:{ valid:true, irErrors:[], ercViolations:[] } }

// 6. Run the transient (compile happens inside).
→ run_simulation { schematic:<S7>, mode:"transient", config:{ duration:"20m", step:"10u", probes:["net_vout"] } }
← { ok:true, data:{ simulationRun:{ id:"sim_rc1", status:"succeeded", results:{ signals:[{ netId:"net_vout", samples:<base64> }] }, … } } }

// 7. Read the step response as plain arrays.
→ read_waveform { simulationRun:<the run>, signal:"net_vout" }
← { ok:true, data:{ signals:[{ netId:"net_vout", unit:"V", t:[0, 1e-5, …], v:[0, 0.0099, …, 0.63 @≈1ms(RC), …] }] } }
```

The agent now has the RC step response (≈63 % of final at t = RC = 1 ms) as numbers it can
describe, plot, or iterate on — the full *"design me an RC low-pass and show me the step
response"* loop, no IR plumbing exposed.

## 7. Boundaries & cross-references

- **Symbol mapping (open question [Q1](open-questions.md)).** `add_instance` / `list_registry`
  are deliberately scoped to **registry** component ids. Authoring arbitrary parts by KiCad
  library symbol is the Q1 boundary (which KiCad lib symbols map to registry ids for import
  of user schematics) — out of scope for this surface until Q1 is resolved; the agent works
  from the curated registry, and KiCad-sourced designs enter via `mcp-kicad` `import`, not
  this server.
- **Co-simulation (resolved [ADR-0018](decisions.md), was Q3).** `run_simulation` here is
  analog-only (`engine:"ngspice"`, transient). Firmware-in-the-loop (MCU GPIO ↔ analog nets)
  is designed separately in [firmware-in-the-loop.md](firmware-in-the-loop.md); when it lands
  as a run `mode`/`engine`, this surface gains it by widening `run_simulation`'s `mode` enum —
  no tool-shape change, because the tool already returns a `simulationRun` IR document.
- **No new engine logic.** Every tool is a translation of an existing pure function; the spike
  adds one package (`schematic-ops`, an extraction) and one server, no new derivation math.

## 8. Follow-up work (filed)

1. **Extract `packages/schematic-ops`** from `apps/web/lib/editor/mutations.ts` (behaviour-
   preserving move + re-export shim). Enabling step; blocks the server.
2. **Implement `packages/mcp-openbench`** — the nine tools above over the shared ops +
   derivation/sim packages, with the never-throw `ToolResult` contract and a round-trip test
   that reproduces the §6 RC transcript end-to-end.

Issue #33 is the dependency for (1) and (2); it is now unblocked.
