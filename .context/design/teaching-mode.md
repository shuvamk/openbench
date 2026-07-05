# Teaching Mode — Lesson Data Model & Step Validation (spike, issue #49)

> Status: **design finding** for issue #49. The decision-of-record is
> [ADR-0022](../decisions.md#adr-0022--teaching-mode-lesson-doc-lives-in-packageslesson-subset-match-predicates-issue-49-2026-07-05).
> This file is the *what/how*; the ADR is the *why*. Implementation is split
> across the follow-up issues listed at the bottom.

Teaching mode lets a teacher author a guided walkthrough (e.g. the college
"7-Segment LED Display" practical) and share it as a link. A student opens the
link, gets the target circuit's shell, and builds it **step by step with live
validation** — each step lights green the moment their schematic matches. AI is
an **optional enhancement**; the core must work with **zero AI and zero backend**.

---

## 1. Where a lesson lives — `packages/lesson` (not the IR)

A lesson is **product metadata wrapped around a target design**, not engine
interchange. The IR (`packages/ir-schema`) is the contract *between engines*
(KiCad ↔ compiler ↔ ngspice); a lesson never crosses an engine boundary and
carries authoring/pedagogy fields (instructions, hints, difficulty) that no
engine consumes. Putting it in the IR would pollute the canonical schema and
force an `irVersion` bump for pedagogy changes.

It is also **not** apps/web-only: predicate evaluation must be a pure, unit-tested
function that both the authoring UI and the student runner import, and that an
MCP tutor tool could call headless later.

**Decision: a new pure package `packages/lesson`** — depends only on
`@openbench/ir-schema` (types) and `@openbench/erc` (violation feed). It exports
the `Lesson`/`Step`/`SchematicPredicate` types, the predicate evaluator, and the
record→steps deriver. Zero engine deps, zero React. Mirrors how `packages/erc`
is a pure IR consumer.

```
packages/lesson
  src/
    types.ts        Lesson, Step, SchematicPredicate, ParamConstraint
    evaluate.ts     evaluateStep(step, schematic, resolveComponent, erc?) → StepResult
    record.ts       deriveStepsFromRecording(mutations, bundle) → Step[]   (author-by-recording)
    serialize.ts    lesson ↔ .openbench-lesson.json envelope + URL codec (reuses #40)
    ai/seam.ts      LessonAI interface + MockLessonAI default (key-optional, mirrors #43)
```

### `les_` id prefix

Lessons get a **`les_`** id prefix. This is a **product-document prefix, not an
IR kind** — it is documented here and in the glossary, and deliberately *not*
added to the ir-schema discriminated union (`cmp_/sch_/net_/sim_/fw_/proj_`).

---

## 2. Lesson & Step shape

```ts
// packages/lesson/src/types.ts

export interface Lesson {
  lessonFormat: "0.1.0";          // versioned independently of irVersion
  id: `les_${string}`;
  title: string;
  description: string;            // markdown
  difficulty: "intro" | "beginner" | "intermediate" | "advanced";
  /** The finished reference circuit + its sim/firmware, a normal ProjectBundle. */
  targetBundle: ProjectBundle;    // from apps/web project-store/types → will move to a shared type
  /** What the student starts from. Omit ⇒ empty schematic; or a partial shell. */
  startBundle?: ProjectBundle;
  steps: Step[];
}

export interface Step {
  id: string;                     // stable, used for progress tracking
  instruction: string;           // markdown shown to the student
  expect: SchematicPredicate;    // PASS condition, evaluated against the live schematic
  hint?: string;                 // static fallback hint (markdown); AI tutor may supersede
  allowAutoPlace?: boolean;      // if true, student may click "do it for me" → applies the
                                 // minimal mutation that satisfies `expect` (from targetBundle)
}
```

`targetBundle` reuses the existing `ProjectBundle` shape
(`apps/web/lib/project-store/types.ts`: `{ project, schematic, simulationRuns?,
firmwareTarget? }`). The lesson-core issue promotes that interface to a shared
location both `apps/web` and `packages/lesson` import (it is already the pinned
dashboard↔editor contract, so this is a move, not a redesign).

---

## 3. `SchematicPredicate` — the crux

A predicate is a **subset match** over the student's live schematic IR: it asserts
that *some* part of the student's design looks a certain way, ignoring everything
else. "A 330 Ω resistor exists whose one pin shares a net with U1 pin `a`" must
pass whether or not the student has also wired the other six segments yet — so
matching is **existential and monotonic**: adding correct structure never turns a
passing step red.

### 3.1 The language

A predicate is a small declarative tree. Leaves assert existence/connectivity;
`all`/`any`/`not` compose them. Instances are referenced by **role variables**
(`"R"`, `"DISP"`) — never by the student's `instanceId`, which the student
chooses freely.

```ts
export type SchematicPredicate =
  | { all: SchematicPredicate[] }        // conjunction — every child must hold
  | { any: SchematicPredicate[] }        // disjunction — ≥1 child (alternative solutions)
  | { not: SchematicPredicate }          // negation (e.g. "no bare short across the source")
  | ComponentClause
  | ConnectedClause;

/** "There is an instance of `of`, meeting `where`, bound to role `as`." */
export interface ComponentClause {
  component: {
    of: string;                    // componentId, e.g. "cmp_resistor_generic"
    as?: string;                   // role variable other clauses can reference
    where?: ParamConstraint[];     // parameter constraints on that instance
    count?: { min?: number; max?: number };  // default {min:1}
  };
}

/** "These pin-refs all sit on ONE shared net." Subset: the net may have more. */
export interface ConnectedClause {
  connected: {
    pins: PinRef[];                // ≥2 refs; all must resolve to the same netId
  };
}

/** A pin either on a role-bound instance, or on the named ground/rail net. */
export type PinRef =
  | { role: string; pin: string }        // e.g. { role: "R", pin: "p2" }
  | { net: string };                     // a *named* net, e.g. { net: "GND" } — matches
                                         // any net whose name equals this (case-insensitive)

export interface ParamConstraint {
  param: string;                         // e.g. "resistance"
  eq?: number | string;
  approx?: { value: number; tolerancePct: number };  // numeric ±% (e.g. 330 Ω ±10%)
  min?: number;
  max?: number;
}
```

### 3.2 Evaluation semantics — existential binding + subset connectivity

`evaluateStep` attempts to find **one binding** of role variables → *distinct*
student instances such that every clause holds:

1. **Component clauses** enumerate candidate instances by `componentId`, filtered
   by `where` (resolved against `component.parameters` defaults +
   `instance.parameterOverrides`). A role binds to any surviving candidate;
   distinct roles must bind to distinct instances.
2. **Connected clauses** hold iff, under the current binding, every `PinRef`
   resolves to the **same `netId`**. A `{ role, pin }` resolves via the bound
   instance's connection in `schematic.nets`; a `{ net }` resolves by net *name*.
   "Same net" is subset-friendly: the net may connect many other pins too.
3. The search is a small backtracking match (roles are few — 2–4 per step). If
   **any** binding satisfies all clauses, the step **passes**.

Resolution is injected (`resolveComponent(componentId) → Component`), exactly like
the netlist compiler and ERC, so `packages/lesson` stays decoupled from the
registry. The evaluator **never throws** — an unresolved component or malformed
predicate yields `passed: false` with a diagnostic, never a crash.

### 3.3 Partial match → pass/fail + progress

`evaluateStep` returns per-clause booleans so the UI can show incremental
progress and target hints, not just a binary:

```ts
export interface StepResult {
  passed: boolean;                 // AND over all top-level clauses under the best binding
  clauses: {                       // one entry per top-level clause, in author order
    satisfied: boolean;
    describe: string;              // "a 330Ω resistor" / "R.p2 connected to DISP.a"
    hintKey?: string;              // drives the templated hint when unsatisfied
  }[];
  warnings: string[];              // ERC-derived (see 3.4) — never affect `passed`
}
```

A step **passes iff every top-level clause is satisfied** under one binding. The
"best binding" for reporting is the one maximising satisfied clauses, so a
half-wired step shows "1 / 2 done" rather than all-or-nothing.

### 3.4 ERC (#35) feeds hints, not pass/fail

After a structural match, the runner calls `checkSchematic` (packages/erc) on the
live schematic and surfaces any violation **touching an instance/net bound in this
step** as a `warning`. Mapping is by violation code → hint template:

| ERC code | Warning surfaced on a teaching step |
| --- | --- |
| `ERC_FLOATING_PIN` | "Segment/pin *X* is placed but not wired to anything yet." |
| `ERC_NO_GROUND` | "Your circuit has no ground reference — add a Ground symbol." |
| `ERC_SINGLE_PIN_NET` | "This wire only touches one pin — connect the other end." |
| `ERC_POWER_NOT_DRIVEN` | "This rail isn't driven by a source." |
| `ERC_OUTPUT_CONFLICT` | "Two outputs are shorted together." |
| `ERC_UNRESOLVED_COMPONENT` | "This part isn't in the registry — pick one from the palette." |

A step can be **structurally passing while still warning** (e.g. the resistor is
correctly on net X but its other pin dangles). Warnings never gate advancement;
they nudge. This keeps validation forgiving (green on correct progress) while ERC
supplies the "why isn't the sim happy" colour.

---

## 4. Worked example — "7-Segment LED Display" (3 steps)

Target: a `cmp_vsource_dc` (5 V), a `cmp_7segment_display` (`cmp_7segment_display`,
common-cathode, pins `a`–`g`,`dp`,`com`), one `cmp_resistor_generic` (330 Ω)
per lit segment, and a `cmp_ground`. Below are the first three authored steps and
their predicates. `resolveComponent` supplies parameter defaults (resistance
default 1000 Ω, so the 330 Ω constraint is meaningful).

**Step 1 — "Place the display and a 5 V supply."**
```jsonc
{
  "id": "s1-parts",
  "instruction": "Drag a **7-Segment Display** and a **5 V DC source** onto the canvas.",
  "expect": { "all": [
    { "component": { "of": "cmp_7segment_display", "as": "DISP" } },
    { "component": { "of": "cmp_vsource_dc", "as": "V",
                     "where": [ { "param": "voltage", "approx": { "value": 5, "tolerancePct": 5 } } ] } }
  ] },
  "hint": "The display is under *Outputs*; the DC source under *Sources*. Set the source to 5 V."
}
```
Passes as soon as both parts exist — wiring not required yet. If the student sets
4.8 V it still passes (±5 %); 3 V fails clause 2 → hint fires.

**Step 2 — "Add a 330 Ω current-limit resistor to segment `a`."**
```jsonc
{
  "id": "s2-resistor-a",
  "instruction": "Wire a **330 Ω** resistor between the supply and segment **a** of the display.",
  "expect": { "all": [
    { "component": { "of": "cmp_resistor_generic", "as": "R",
                     "where": [ { "param": "resistance", "approx": { "value": 330, "tolerancePct": 10 } } ] } },
    { "connected": { "pins": [ { "role": "R", "pin": "p1" }, { "role": "V", "pin": "pos" } ] } },
    { "connected": { "pins": [ { "role": "R", "pin": "p2" }, { "role": "DISP", "pin": "a" } ] } }
  ] },
  "hint": "One resistor pin to the +5 V node, the other to the display's **a** pin.",
  "allowAutoPlace": true
}
```
Note the binding reuses roles `V`/`DISP` from step 1's structure (roles are
per-step, but the *same student instances* satisfy them). Subset matching means
the +5 V net can already fan out to other segments. ERC `ERC_FLOATING_PIN` on the
display's still-unwired segments shows as warnings, not failures.

**Step 3 — "Ground the display's common cathode."**
```jsonc
{
  "id": "s3-ground",
  "instruction": "Connect the display's **COM** (common cathode) to **Ground**.",
  "expect": { "all": [
    { "component": { "of": "cmp_ground", "as": "GND" } },
    { "connected": { "pins": [ { "role": "DISP", "pin": "com" }, { "role": "GND", "pin": "gnd" } ] } }
  ] },
  "hint": "Add a Ground symbol and wire it to **COM**. Common-cathode displays sink current to ground."
}
```
Once step 3 passes, ERC's `ERC_NO_GROUND` clears, and the lesson can offer "Run
simulation" to watch segment `a` light in the live view.

---

## 5. Authoring source — author-by-recording (reuses #18)

**Recommendation: author by recording, with hand-editable predicates.** The
editor already records a mutation/undo history (#18). Teaching-author mode:

1. The author builds the target circuit; each undo-history batch (a coherent group
   of mutations — "added R1", "wired R1.p2→DISP.a") becomes a **candidate step**.
2. `deriveStepsFromRecording(mutations, bundle)` turns each batch's *diff* into an
   `expect` predicate structurally: instances added → `component` clauses (with a
   role auto-assigned and `where` seeded from the placed parameter values); nets
   formed/extended → `connected` clauses over the touched pins. This is the
   **same structural derivation the AI seam would produce — so it works with zero
   AI**.
3. The author edits: rewrites `instruction` markdown, loosens constraints (e.g.
   turns an exact 330 into `approx ±10%`), merges/splits steps, adds `hint`s.

Hand-authoring a predicate from scratch stays fully supported (it is just JSON),
but recording is the default because it guarantees the predicate is *satisfiable
by the exact mutations that built the target* — no drift between "what the lesson
asks" and "what the reference circuit is".

---

## 6. Distribution — stateless, reuses share links (#40), no backend

A lesson serializes into the **same envelope as the share-link work (#40)**: a
`.openbench-lesson.json` file and a compressed URL fragment. The `targetBundle`
(and optional `startBundle`) ride along inside it; there is **no server**
(ADR-0008 — client-side only). Opening a lesson URL hydrates the student's editor
from `startBundle` (or empty) and loads `steps` into the runner panel. Because it
is the #40 codec with a `lesson` payload instead of a bare bundle, share and
teaching links share one implementation and one size budget.

---

## 7. AI seam — optional, key-optional mock (mirrors #43)

Two AI touch-points, both behind an interface whose **default implementation is a
deterministic mock**, so nothing breaks without an API key — exactly the seam
shape #43 established for the copilot:

```ts
export interface LessonAI {
  /** Draft instruction prose + refined predicates from a recording. */
  autoAuthor(bundle: ProjectBundle, recording: Mutation[]): Promise<Step[]>;
  /** Explain why a step isn't passing, given the live schematic + ERC. */
  tutor(step: Step, schematic: Schematic, erc: ErcViolation[]): Promise<string>;
}

export class MockLessonAI implements LessonAI {
  // autoAuthor → deriveStepsFromRecording (§5) verbatim; instruction = a templated
  //   "Add <part> / connect <a> to <b>" string.
  // tutor → the step's static `hint` plus the templated ERC/clause messages (§3.3–3.4).
}
```

The real (key-backed) implementation only *upgrades* the prose and predicate
quality; the entire teaching-mode feature — author, share, validate, hint — runs
end to end on `MockLessonAI`. AI is strictly additive.

---

## 8. Follow-up implementation issues (this spike unblocks them)

Dependency order (each depends on the one above). All four filed by this spike:

1. **[#89] lesson core** (`area:frontend`/`packages/lesson`, p1) — the package: types,
   `evaluateStep` + backtracking binding matcher, ERC warning feed, unit tests
   incl. the §4 worked example. **Depends on:** #35 (ERC, closed), #44 (7-seg,
   closed) — **unblocked now**. Enables 2–4.
2. **[#90] authoring by recording** (p2) — `deriveStepsFromRecording` + teaching-author
   editor mode. **Depends on:** #89, #18 (undo history, closed).
3. **[#91] student runner panel** (p2) — **DONE (#91).** `apps/web/lib/lesson/runner.ts`
   (`deriveRunnerView`, pure) + `apps/web/components/lesson/StudentRunnerPanel.tsx`: a
   side panel that subscribes to the editor IR store, debounces, re-evaluates every step
   via `evaluateStep`, and drives a linear stepper — per-clause checklist, greens +
   advances the active step on pass, keeps it red with its hint on a wrong value, and
   surfaces ERC issues as inline non-blocking warnings (§3.4). The `allowAutoPlace`
   "do it for me" affordance is **deferred to a follow-up** — it needs a minimal-
   satisfying-mutation engine derived from `targetBundle`, out of scope for the
   validation panel. Loading a lesson from a share link is #92's codec work.
4. **[#92] lesson share + AI seam** (p2) — `.openbench-lesson.json` + URL codec on the
   #40 share codec; `LessonAI` interface + `MockLessonAI`; wire real key-backed
   impl behind #43's provider. **Depends on:** #89, #40 (share, open), #43 (AI, open).
