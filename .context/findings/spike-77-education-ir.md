# Spike #77 — per-component contextual learning: format + `education` IR shape

> **Status: complete. Verdict: GO.** Gate finding for epic #76; unblocks
> #78 (ir-schema) → #79 (registry content) → #80 (Learn panel) → #81 (live knob).
> Time-boxed research output — a written finding + a throwaway calculation, not
> production code. The real changes live in the four blocked children.

## Question

Is component-level, live, contextual micro-learning **fun and useful**, and what
is the right **optional `education` IR shape** to express it — pressure-tested by
hand against LED + resistor before any framework is built?

## TL;DR

- **GO on the format.** The straw-man block, lightly refined, captures what a
  beginner needs for both hero parts with **zero per-part custom code**. Keep it
  additive/optional → `ir-schema-guard` patch bump (`0.1.0 → 0.1.1`), never breaking.
- **The live knob carries the fun**, and it is *nearly free*: `deriveInstanceStates`
  already emits `current` + `brightness` series for the LED. The knob is "override
  one parameter → re-run the existing sim → watch the existing series move." No new
  physics engine, no per-part animation code.
- **One refinement to the straw-man:** `interactiveHint` must address the knob to a
  **parameter on another instance** (resistor's `resistance`), not only a param on
  the part being taught (the LED has no editable params). It needs a target
  selector + an observed series on the *subject* instance. Spec below.
- **No per-part escape hatches in the IR.** Everything LED + resistor needed fits
  the declarative fields. Escape hatches become a content treadmill; resist them.
  Where a formula won't render as plain text, that is a renderer concern (#80), not
  an IR field.

---

## 1. The `education` block — recommended shape

Optional top-level field on the `component` IR kind. Every sub-field is optional so
partial authoring is valid and existing components stay valid untouched.

```jsonc
"education": {
  // one-line "what is this / what does it do", plain language
  "summary": "A one-way valve for current that emits light when it conducts.",

  // beginner traps, each a short standalone sentence
  "gotchas": [
    "Polarity matters: the long leg (anode) goes toward +, short leg (cathode) to −.",
    "An LED has almost no resistance of its own — always put a resistor in series or it burns out."
  ],

  // display string + the variables it relates; rendered as text, NOT executed
  "keyFormula": {
    "display": "I = (V_supply − V_f) / R",
    "variables": {
      "I": "current through the LED (aim for ~10–15 mA for a bright indicator)",
      "V_f": "LED forward voltage, ~1.4–2.0 V (fixed by the LED, not by you)",
      "R": "the series resistor you choose"
    }
  },

  // per-parameter notes, keyed by this component's own parameter names.
  // Empty for the LED (it declares no parameters); rich for the resistor.
  "paramNotes": {},

  // the "try it" knob — see §2 for the resolved shape
  "interactiveHint": {
    "targetParam": "resistance",
    "targetComponentId": "cmp_resistor_generic",  // param lives on a *series* part
    "observe": "brightness",                        // series on THIS instance to watch
    "prompt": "Lower the series resistor and watch the LED get brighter — go too low and you'll cook it."
  }
}
```

### Field reference

| field | type | required | meaning |
|---|---|---|---|
| `summary` | `string` | no | one-line plain-language description |
| `gotchas` | `string[]` | no | beginner traps, each standalone |
| `keyFormula` | `{ display: string; variables: Record<string,string> }` | no | display-only formula + variable glossary. **Never evaluated** — it is teaching text, distinct from `simModel.derivedParams` which *is* evaluated. |
| `paramNotes` | `Record<string,string>` | no | keyed by this component's declared parameter names; validator SHOULD warn (not error) on unknown keys so registry authors catch typos |
| `interactiveHint` | object, see §2 | no | one "try it" knob |

**Additivity proof:** it is one optional object on `componentObjectSchema`
(`packages/ir-schema/src/component.ts:87`). `refineComponent` gains only *soft*
checks (unknown `paramNotes` key → warning). Every existing registry component
omits it and stays valid → additive → **patch bump `irVersion` 0.1.0 → 0.1.1**.
Adapters (KiCad/ngspice/firmware) ignore it: it is read-only human metadata, so no
round-trip contract changes. Confirm with `ir-schema-guard` in #78.

---

## 2. The live knob — resolved `interactiveHint` shape (the important refinement)

The straw-man assumed the knob wiggles "a param on the part." **That breaks on the
LED**, whose `parameters: []` — there is nothing on the LED to wiggle. The fun comes
from an *upstream* part (the series resistor). So the hint must point at a parameter
on a possibly-different component and name the series to watch on the subject:

```jsonc
"interactiveHint": {
  "targetParam": "resistance",                  // parameter name to expose as a slider
  "targetComponentId": "cmp_resistor_generic",  // OPTIONAL: whose param. Omit → subject's own param.
  "observe": "brightness",                       // series key from deriveInstanceStates to highlight
  "prompt": "..."                                // one sentence framing the experiment
}
```

Resolution rule for the panel (#80/#81):
- If `targetComponentId` is omitted → the slider edits `targetParam` on the selected
  instance itself (this is the resistor's own case: teach the resistor by wiggling
  its own `resistance`).
- If present → the panel finds the **nearest instance of that component wired in
  series** with the subject and edits *its* `targetParam`. "Nearest in series" =
  walk the subject's pins → net → other instances; for the hero LED+R+source loop
  this is unambiguous. If none found, the panel hides the knob (graceful, no error).
- `observe` names a series produced by `deriveInstanceStates` for the subject's
  `liveKind` (`brightness`, `current`, `intensity`, `rpmFraction`, …). The panel
  re-runs the existing sim with the override and animates that series.

### Why the knob is fun — measured, not asserted

Throwaway calc (scratch, discarded) using the repo's **own** LED model
(`apps/web/lib/live/derive.ts`: `Is=1e-14`, `n=2`, 50 mA clamp, 15 mA = "fully
bright") across a 5 V supply + series R + LED loop:

| R (Ω) | LED current | brightness (repo's `clamp01(I/15mA)`) |
|---:|---:|---:|
| 220 | 16.1 mA | **100%** |
| 470 | 7.6 mA | 51% |
| 1 000 | 3.6 mA | 24% |
| 2 200 | 1.7 mA | 11% |
| 10 000 | 0.4 mA | 2% |
| 100 | 35 mA | 100% (**and cooking** — >20 mA) |

The slider produces a wide, monotonic, *visible* brightness sweep, and the `current`
readout doubles as the safety lesson (drop below ~220 Ω and you're past a real LED's
rating). That is the "aha." **It needs nothing new**: `deriveInstanceStates` already
returns `current` and `brightness` for `kind:"led"` (derive.ts:214–231). #81 is
"expose a slider that writes a `parameterOverride` and re-invokes the live pipeline,"
not "build LED physics."

**Verdict on fun:** the live knob is *sufficient* on its own for LED+resistor. It
does **not** need gamification, quizzes, or animation beyond what Live mode renders.
The static `summary`/`gotchas`/`keyFormula` are worthwhile but secondary — they frame
the experiment; the knob delivers the payoff.

---

## 3. Hand-authored content for the two hero parts

Pressure-testing the shape by filling it in fully (this is the deliverable's core —
does the format hold without per-part code? **Yes.**). These become #79's seed content.

### LED (`cmp_led_generic`)

```jsonc
"education": {
  "summary": "A one-way valve for current that glows when current flows the right way.",
  "gotchas": [
    "Polarity matters: current only flows anode (long leg, +) → cathode (short leg, −).",
    "An LED barely resists current on its own — always add a series resistor or it burns out.",
    "Forward voltage (~1.4–2 V) is roughly fixed; you control brightness with the resistor, not the LED."
  ],
  "keyFormula": {
    "display": "I = (V_supply − V_f) / R",
    "variables": {
      "I": "current through the LED; ~10–15 mA is a bright, safe indicator",
      "V_f": "forward voltage, set by the LED (~1.4–2 V), not by you",
      "R": "the series resistor — this is your brightness knob"
    }
  },
  "paramNotes": {},
  "interactiveHint": {
    "targetParam": "resistance",
    "targetComponentId": "cmp_resistor_generic",
    "observe": "brightness",
    "prompt": "Drag the series resistor down and watch the LED brighten — too low and the current gets dangerous."
  }
}
```

### Resistor (`cmp_resistor_generic`)

```jsonc
"education": {
  "summary": "Limits how much current flows — the workhorse for protecting parts and setting levels.",
  "gotchas": [
    "Bigger resistance means less current, not more — it's the brake, not the gas.",
    "Real resistors turn blocked energy into heat; a tiny value across a supply can overheat.",
    "Resistors have no polarity — either way round is fine."
  ],
  "keyFormula": {
    "display": "V = I × R   (Ohm's law)",
    "variables": {
      "V": "voltage dropped across the resistor",
      "I": "current through it",
      "R": "its resistance in ohms"
    }
  },
  "paramNotes": {
    "resistance": "Ohms. In a resistor+LED loop this sets the LED current directly: I ≈ (V_supply − V_f) / R."
  },
  "interactiveHint": {
    "targetParam": "resistance",
    "observe": "current",
    "prompt": "Sweep the resistance and watch the current respond — this is Ohm's law you can feel."
  }
}
```

Both filled cleanly with the declarative fields alone. **No per-part escape hatch
was needed.** The only asymmetry (LED's knob lives on the resistor, resistor's on
itself) is fully expressed by optional `targetComponentId` — no special-casing.

---

## 4. Skill-level / opt-in gating recommendation

- **Content is always in the IR; visibility is a UI preference, not an IR field.**
  Do **not** add a `skillLevel` or `audience` field to `education`. Gating belongs in
  the editor (a "Learn" toggle / user setting), so the same IR serves a beginner and
  an expert. Keeps the IR about the part, not about the reader.
- **Default: Learn panel present but collapsed.** The `hasLiveVisual` precedent
  (derive.ts:123) shows the codebase already nudges beginners contextually; mirror
  that — surface the Learn affordance when a selected component *has* an `education`
  block, collapsed by default, remembered per user. No modal, no forced tour.
- **The knob is opt-in by construction** — it only appears when `interactiveHint`
  resolves to a real in-circuit target. Nothing to gate.

---

## 5. Refined specs for the blocked children

### #78 — ir-schema: add optional `education` block
- Add `educationSchema` to `packages/ir-schema/src/component.ts`, wired as an optional
  field on `componentObjectSchema` (§1 table for exact types).
- `keyFormula.display` is a plain string — **never** parsed/evaluated (contrast
  `derivedParams`). Add a doc comment saying so, so no one wires it into the compiler.
- `paramNotes` unknown-key handling: **warn, don't error** (soft check in
  `refineComponent`) — registry typos should be visible but not block validation.
- Tests (red first): (a) component with a well-formed block validates; (b) one
  without it validates (backward-compat); (c) malformed block (e.g. `gotchas: "x"`
  not array) → structured `{path,message}`, never throws; (d) every existing registry
  component still validates unchanged; (e) `irVersion` 0.1.1 compat test.
- Run `ir-schema-guard`; bump `irVersion` **0.1.0 → 0.1.1**; update
  `.context/interchange-format.md` component block + `.context/engine-status.md`.

### #79 — registry: author `education` for hero parts
- Land the LED + resistor blocks from §3 verbatim as the seed; add **capacitor** as
  the third (summary + gotchas + `V = Q/C` / RC-time note; its knob: wiggle
  `capacitance`, `observe` an RC waveform once a suitable demo exists — or ship
  capacitor with static fields only and no `interactiveHint` if no clean live target).
- Test: each authored block passes `validateComponent`; `paramNotes` keys ⊆ declared
  parameter names; `interactiveHint.observe` is a series key the part's `liveKind`
  actually emits.

### #80 — editor: generic Learn panel
- Add to `Inspector.tsx` (currently 145 lines; renders params + ERC). New collapsible
  "Learn" section, **only** when `component.education` exists. Astryx components only
  (no raw hex): a `Text`-based summary, a bulleted gotchas list, the formula as
  monospaced `Text`, `paramNotes` inline beside the matching `NumberInput`.
- Purely declarative render of the block — **no per-part branching in the panel.**
  Test with LED (empty paramNotes) and resistor (rich paramNotes) fixtures.

### #81 — live "try it" knob
- Resolve `interactiveHint` per §2 (own-param vs series-target; hide if unresolved).
- Slider writes a `parameterOverride` on the resolved instance, re-runs the existing
  live pipeline (`deriveInstanceStates` + the sim already wired for Live mode), and
  highlights the `observe` series. **No new physics.**
- Generalization beyond R→LED: the same three fields (`targetParam`,
  `targetComponentId?`, `observe`) drive *any* part — motor `vnominal`→`rpmFraction`,
  lamp series-R→`intensity`, capacitor→RC waveform. The knob is component-agnostic;
  content authors pick the target, the panel stays generic.
- Test: given the hero LED+R+source fixture, moving the resistor slider changes the
  LED's `brightness` series in the derived states monotonically (assert on
  `deriveInstanceStates` output at two R values, e.g. 220 Ω vs 2.2 kΩ).

---

## 6. Decisions taken (autonomy rule)

1. `education` is **UI metadata, not simulated data** — `keyFormula` is display-only,
   separate from the evaluated `derivedParams`. Prevents a content field leaking into
   the netlist compiler.
2. **No `skillLevel` in the IR** — gating is a UI preference so one document serves
   all readers.
3. `interactiveHint` gets an **optional `targetComponentId`** so the knob can address a
   series part (the LED case) — the single change that made the format hold for both
   hero parts without escape hatches.
4. **No per-part escape hatch** in the IR. If a future part truly needs one, revisit
   then with evidence; default is declarative-only to avoid a content treadmill.

_See `.context/decisions.md` ADR-0023 for the condensed record._
