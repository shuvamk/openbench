# Firmware-in-the-loop — ESP32 QEMU ↔ circuit GPIO bridge

> **Status:** design finding (spike #29, 2026-07-04); **items 1–3 implemented**
> (#64/#65/#66, 2026-07-05). This document is the written output of the time-boxed
> research asked for in issue #29 and is referenced by **ADR-0018**. It closes the last
> open piece of the Phase-1 loop (`firmware → virtual MCU → circuit`) at the *design*
> level and resolves open question **Q3**. Item 4 (Direction-B lockstep) is now designed too
(spike #67 → ADR-0024, `.context/cosim-lockstep.md`).
>
> **Implementation status (bottom of file lists the issues):**
> - Item 1 (#64) — `packages/mcp-firmware-platformio/src/gpio-poller.ts`: `GpioPoller` /
>   `pollGpio` sample `GPIO_OUT`/`GPIO_ENABLE` over a `MemoryReader` → edge `(t,gpio,level)`.
> - Item 2 (#65) — `.../src/gpio-pwl.ts`: `gpioEventsToPwl(pinNetMap, events)` → one PWL
>   `V`+`Rout` source per driven, net-bound pin.
> - Item 3 (#66) — `apps/web/lib/live/firmware.ts`: derives the ESP32 `GPIO→netId` map
>   from the schematic, runs the #65 translator, samples each PWL onto the run's time grid,
>   and returns a `simulationRun` (`engine:"qemu"`) that `derive.ts` consumes unchanged —
>   so an emulated GPIO2 blink animates the on-canvas LED. Live-view fidelity: the driven
>   net's voltage is taken as the PWL source level (VOH/0) rather than re-solved through
>   WASM ngspice, consistent with ADR-0013's visual-fidelity stance; the PWL cards stay the
>   canonical stimulus for a verification-grade ngspice re-run.

## The gap this closes

Phase 1 has three engines that individually work but do not yet talk across the
digital/analog boundary:

- `mcp-firmware-platformio` builds an ESP32 firmware image and emits a **qemu-xtensa-esp32
  launch stub** (`generateVirtualMachineConfig`, ADR-0011) — but nothing runs it and
  nothing observes it.
- `mcp-sim-ngspice` solves the **analog** circuit from a netlist (transient, WASM backend).
- The **live view** (`apps/web/lib/live/derive.ts`, ADR-0013) animates a circuit from
  node voltages that come *only* from the analog simulator or interactive parts.

Missing: when the emulated firmware does `digitalWrite(2, HIGH)`, nothing turns GPIO2's
net into 3.3 V in the circuit. That is the "firmware-in-the-loop" bridge. This finding
decides **how QEMU exposes that GPIO change** and **how the change enters the netlist**.

## Question 1 — how does qemu-xtensa-esp32 expose GPIO state?

Espressif's QEMU fork has **no first-class GPIO-introspection API** — no QMP `query-gpio`,
no dedicated device property you can poll for pin levels. (Confirmed against the ESP-IDF
QEMU guide and the esp-toolchain-docs QEMU README: the documented surfaces are the UART
console, the QEMU *monitor* for "inspecting registers and memory", the GDB stub via
`-s -S`, and `--qemu-extra-args`/`-d` trace output. GPIO observation is not addressed.)

So GPIO must be observed **indirectly**. ESP32 GPIO output state lives in memory-mapped
registers, which is the lever every option below pulls on:

| Register | Address | Meaning |
| --- | --- | --- |
| `GPIO_OUT_REG` | `0x3FF44004` | output level, GPIO 0–31 (bit N = pin N) |
| `GPIO_OUT1_REG` | `0x3FF44010` | output level, GPIO 32–39 |
| `GPIO_ENABLE_REG` | `0x3FF44020` | output-enable (driving vs. Hi-Z), GPIO 0–31 |
| `GPIO_ENABLE1_REG` | `0x3FF4402C` | output-enable, GPIO 32–39 |
| `GPIO_IN_REG` | `0x3FF4403C` | **input** sampled level, GPIO 0–31 (reverse direction) |

A pin's electrical state is `(GPIO_ENABLE bit) ? (GPIO_OUT bit ? HIGH : LOW) : Hi-Z`.
Reading these two registers fully describes every push-pull output the firmware drives.

### The four candidate observation mechanisms

1. **GDB-stub memory polling.** Launch `qemu-system-xtensa … -s` (GDB server on :1234),
   attach a thin GDB/RSP client, and periodically read the five registers above with a
   memory-read packet (`m3ff44004,4`). Pure stock QEMU — no custom build, no firmware
   changes. Downside: sampled, so transitions faster than the poll interval are missed
   (fine for a human-legible live view; see cadence below).
2. **QMP / HMP memory read.** Same idea via `-qmp`/monitor `xp /1wx 0x3ff44004`. Works,
   but QMP memory access is clunkier than RSP and still sampled. No advantage over GDB;
   GDB additionally gives us hardware **watchpoints** later (see "future").
3. **Trace-event parsing.** `-d`/`--qemu-extra-args` trace output on the GPIO device.
   Would give exact, event-accurate transitions — but depends on trace points existing in
   the Espressif GPIO device model, which are not a documented/stable surface. Fragile
   across QEMU versions; parsing a debug log as a control channel is brittle.
4. **Firmware-side UART instrumentation.** Wrap `digitalWrite`/GPIO ISRs to print pin
   changes over the (already-available) emulated UART. Deterministic and exact, but
   **invasive** — it only works for firmware we instrument, not arbitrary user firmware.
   Rejected as the primary bridge for that reason; kept as an optional high-fidelity mode.

### Decision — mechanism

**GDB-stub memory polling of `GPIO_OUT`/`GPIO_ENABLE`.** It is the only option that is
(a) non-invasive to user firmware, (b) works against the stock `qemu-system-xtensa` we
already emit a launch stub for, and (c) needs no custom QEMU build or unstable trace
surface. Event-accuracy is sacrificed, which is acceptable because the consumer is the
**live view**, not a signed-off timing simulation.

**Polling vs. events, resolved:** poll, don't parse traces. The live view already runs on
a debounced cadence (interactive parts re-simulate on a 300 ms debounce, ADR-0013), so a
poll in the **10–30 Hz** band (33–100 ms) is well matched — fast enough to feel live,
slow enough to be cheap, and it reads a snapshot of *truth* (the registers) rather than
reconstructing state from a lossy event log. A future high-fidelity path can swap polling
for GDB **watchpoints** on the registers to get event-accurate edges without changing the
consumer.

## Question 2 — how do firmware-driven pin states enter the netlist?

**Yes: a voltage source per driven GPIO net — specifically a piecewise-linear (PWL)
source.** The bridge turns the GPIO poll timeline into a per-net stimulus the existing
netlist compiler + ngspice already understand.

### Direction A — firmware → circuit (output pins) — *this is the Phase-1-completing path*

1. **Bind GPIO number → schematic net.** No new IR field is required: the schematic
   already connects the `cmp_esp32_devkit` instance's pins to nets. The bridge reads the
   ESP32 instance's pin→net connections and maps *GPIO number → netId*. (The devkit's pin
   labels — `IO2`, `IO4`, … — already name the GPIO.) This keeps the binding derived, not
   duplicated.
2. **Convert the poll timeline to PWL.** Each driven net accumulates `(t, level)` samples:
   `HIGH → VOH` (default 3.3 V), `LOW → 0 V`, `Hi-Z → skip / high-impedance`. Emit a SPICE
   PWL source on that net: `V{gpioN} <net> 0 PWL(0 0 0.033 0 0.033 3.3 …)` with a short
   (~1 µs) ramp at each edge to keep the solver stable. A series **output resistance**
   (ESP32 push-pull ≈ tens of Ω; use a documented nominal, e.g. 30 Ω) models drive
   strength so the source is not ideal-stiff.
3. **Re-solve.** Feed the augmented netlist to the existing ngspice path; the live view
   consumes the resulting node voltages exactly as it does today. GPIO-driven nets simply
   gain a *source* they did not have before — no change to `derive.ts`'s consumption side.

This reuses the whole existing stack (netlist-compiler PWL/source handling, the SIN/DC
source precedent from the registry, ngspice transient, the live renderer). The **only**
new machinery is the QEMU poll loop + the GPIO→net→PWL translation.

### Direction B — circuit → firmware (input pins) — *deferred, path noted*

The reverse (a sensor node voltage → `digitalRead`/ADC inside the emulator) requires
**writing** `GPIO_IN_REG` (`0x3FF4403C`) — or the ADC result registers — from outside, on
a threshold, and running the emulator and analog solver in lockstep. That is genuine
mixed-signal co-simulation with a synchronization contract (who steps whom, and by how
much). It is out of Phase-1 scope and deliberately deferred. The GDB stub *can* write
registers, so the mechanism exists; what is missing is the lockstep scheduler. Documented
here so the next spike starts from a decision, not a blank page.

## Recommended IR / integration shape (no IR change in this spike)

This spike **does not** touch `packages/ir-schema` — it is research. The recommended shape
when implementation lands:

- **`simulationRun.engine: "qemu"`** already exists in the enum (`.context/interchange-format.md`
  line 108 lists `"renode"`/`"qemu"`). A firmware-in-the-loop run is a `simulationRun` whose
  `engine` is `"qemu"` and whose result is the **co-simulated** waveform set (analog nodes
  with GPIO-driven sources baked in). Mode enum for this engine: `"live"` (continuous poll)
  vs. a future `"cosim"` (lockstep, bidirectional).
- **No new binding field** on `firmwareTarget`: the GPIO→net map is derived from the
  schematic's ESP32 pin connections (above). If a future part exposes GPIOs ambiguously, a
  small optional `firmwareTarget.gpioMap?: Record<gpioNumber, netId>` override is the
  additive, non-breaking escape hatch — mirroring how `x_openbench_*` and `derivedParams`
  were added without an `irVersion` bump. Flagged, not built.
- **Drive parameters** (`VOH = 3.3 V`, `Rout ≈ 30 Ω`, edge ramp ≈ 1 µs) are bridge
  constants documented alongside `derive.ts`, consistent with ADR-0013 treating live-mode
  physics as documented visual-fidelity approximations.

## Non-goals (kept out on purpose)

- Cycle-accurate or timing-signed co-simulation. The bridge targets the *live view*, not a
  verification-grade mixed-signal run.
- Bidirectional lockstep (Direction B) — deferred with its mechanism identified.
- Any custom QEMU build, patched GPIO device, or trace-format dependency.
- Instrumenting user firmware (the UART-shim option) as the primary path.
- Non-Xtensa MCUs — ADR-0011 keeps `renode` in the enum for Phase 2 STM32 etc.; this
  finding is ESP32/QEMU only.

## Follow-up issues this finding enables (file, don't build here)

1. `feat` / `area:mcp-firmware` — **QEMU GDB-RSP client + register poller**: launch the
   existing machine stub with `-s`, poll `GPIO_OUT`/`GPIO_ENABLE`, emit a `(t, gpioN,
   level)` event stream. Acceptance: given a fixture firmware that toggles GPIO2 at 1 Hz,
   the poller yields alternating HIGH/LOW events for GPIO2 and nothing for undriven pins.
2. `feat` / `area:mcp-firmware` (or a new `packages/cosim`) — **GPIO→net→PWL translator**:
   pure function `(esp32PinNetMap, gpioEventStream) → PWL source cards`. Acceptance:
   a HIGH→LOW→HIGH timeline on a net bound to GPIO2 produces a PWL `V` card with the right
   breakpoints, `VOH`/`0 V` levels, series `Rout`, and ramps; Hi-Z windows emit no drive.
3. `feat` / `area:frontend` — **live firmware mode**: wire the poll→PWL→ngspice→`derive.ts`
   loop behind the live view so an emulated blink actually blinks the on-canvas LED.
   Acceptance: blink firmware + LED-on-GPIO2 schematic → LED brightness animates in step
   with the emulator.
4. `spike` / `area:mcp-firmware` — **Direction B lockstep design**: how to write
   `GPIO_IN`/ADC registers from node voltages and step emulator↔ngspice in lockstep
   (resolves the remaining mixed-signal question).

Items 1–3 are the concrete Phase-1.5 loop; item 4 is the Phase-2 bidirectional door.

**Status:** items 1 (#64), 2 (#65) and 3 (#66) are ✅ landed — the poll→PWL→derive loop
now blinks the on-canvas LED end to end (see the implementation-status note at the top of
this file). Item 4 (Direction-B lockstep) is now **designed** (spike #67 → ADR-0024,
`.context/cosim-lockstep.md`): scheduler-master conservative fixed-quantum lockstep with
GDB register-write injection into `GPIO_IN`/ADC, `mode:"cosim"`, no IR change. Its own
implementation follow-ups (RSP write seam, lockstep scheduler, ADC live-verify, frontend
cosim mode) are enumerated there.
