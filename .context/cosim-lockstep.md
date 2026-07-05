# Direction-B lockstep co-sim — circuit → firmware (GPIO_IN / ADC injection)

> **Status:** design finding (spike #67, 2026-07-06); **no code**. This is the written
> output of the time-boxed research asked for in issue #67 and is captured as **ADR-0024**.
> It designs the *reverse* half of the firmware-in-the-loop bridge — the piece ADR-0018 /
> `.context/firmware-in-the-loop.md` deliberately deferred ("Direction B"). It opens
> Phase-2 true mixed-signal: a sensor-node voltage becomes a `digitalRead`/ADC value
> *inside* the emulator. Deliverable is this finding + the ADR; the next worker starts from
> a decision, not a blank page.

## Recap — what already exists (Direction A)

`.context/firmware-in-the-loop.md` (ADR-0018) built and shipped the **firmware → circuit**
direction (#64/#65/#66):

- `gdb-rsp.ts` — RSP packet framing + checksum, an `m addr,len` **read** builder, a
  little-endian word decoder, and a transport-injected `MemoryReader`.
- `gpio-poller.ts` — samples `GPIO_OUT`/`GPIO_ENABLE` over the stock `qemu-system-xtensa`
  GDB stub (`-s`) at 10–30 Hz → `(t, gpio, level)` events.
- `gpio-pwl.ts` + `apps/web/lib/live/firmware.ts` — events → PWL `V`+`Rout` source per
  driven net → `derive.ts` animates the on-canvas part.

That path is **one-directional and asynchronous**: the poller reads a *snapshot of truth*
(the registers) at a debounced cadence and never has to pause the emulator. Direction B
cannot be asynchronous — writing an input value at the wrong virtual instant changes what
the firmware computes. Hence a **synchronization contract** is the whole problem.

## The four questions this spike must answer

Issue #67 asks for a written finding + ADR answering: **(1) step-ownership**, **(2) sync
granularity**, **(3) the GPIO_IN/ADC write mechanism**, and **(4) the IR/mode shape** for a
lockstep qemu run. Each is decided below.

---

## Q1 — Step-ownership: who steps whom, by how much?

**Decision: a neutral co-sim *scheduler* owns the clock; QEMU and ngspice are both slaves
advanced to a shared time barrier. Conservative fixed-quantum lockstep.**

Neither engine has a natural hook to "call the other." QEMU is instruction-driven; ngspice
is an adaptive-timestep transient solver. Making either one the master means teaching it to
host the other's loop — invasive on both sides. Instead a small external orchestrator (a
`packages/cosim` scheduler) owns virtual time `t`, exactly mirroring how `pollGpio` already
owns the Direction-A loop. This is the standard **conservative / time-stepped** co-sim
pattern (a lockstep barrier per quantum), not optimistic/rollback co-sim (which would need
checkpoint+restore neither engine offers cheaply).

The round, for global time advancing `t_k → t_{k+1} = t_k + Δt`:

1. **Advance QEMU by Δt.** Run the emulator for exactly one quantum of *virtual* time,
   then halt at the barrier.
2. **Read outputs** (Direction A, unchanged): `GPIO_OUT`/`GPIO_ENABLE` → update the PWL
   source cards for firmware-driven nets.
3. **Advance ngspice by Δt**, transient, with those sources held over `[t_k, t_{k+1}]`.
4. **Sample analog inputs** at the barrier: read the node voltages that feed the ESP32's
   input pins / ADC channels.
5. **Quantize + write into QEMU** (Direction B, the new work): threshold each digital-in
   net → a bit in `GPIO_IN_REG`; map each ADC net's voltage → a SAR code. Write those
   registers over the GDB stub **before** the next QEMU step.

Neither engine ever runs more than one quantum ahead of the other → no causal violation
across the barrier. Within a quantum each engine sees the *other's value from the previous
barrier* held constant — the classic zero-order-hold co-sim approximation, documented as a
fidelity limit (below), not a bug.

**Determinism requirement (new vs. ADR-0018):** QEMU must launch with **`-icount shift=N`**
so virtual time is a deterministic function of executed instructions. Without `-icount`,
`qemu-system-xtensa` free-runs on wall-clock and "advance by Δt" is nondeterministic and
un-reproducible — fatal for lockstep. With `-icount`, "advance by Δt" becomes "continue for
`Δt / t_per_insn` instructions," achievable with a timed `vCont;c` bounded by an
icount-deadline (or single-stepping in a tight MVP). `-icount` is therefore the one new
QEMU-launch flag this direction adds on top of ADR-0018's `-s`.

---

## Q2 — Sync granularity: how big is Δt?

**Decision: a fixed conservative quantum is the *contract*; a GDB read-watchpoint
"resync-on-read" fast path is the *optional fidelity escalation* — mirroring ADR-0018's
poll→watchpoint story.**

- **Baseline fixed quantum `Δt` (config knob `cosimQuantumUs`).** Sized to the fastest
  input the firmware actually samples. Sensible defaults:
  - **digital-in** (a button, a comparator threshold → `digitalRead`): 100 µs–1 ms is
    ample; it matches the Direction-A live-view fidelity band and stays cheap.
  - **ADC sampling loops**: the quantum must be ≤ the firmware's inter-sample period, so a
    finer default (e.g. 10–50 µs) applies when any ADC channel is mapped.
- **Optional event-driven resync.** The analog value only has to be *correct at the instant
  firmware reads the register*. So the elegant granularity is: keep the coarse global
  quantum for the barrier, but set a **GDB read-watchpoint on the input registers**
  (`GPIO_IN_REG` / the `SENS_SAR_MEAS*` result regs). When firmware reads one, QEMU traps;
  the scheduler advances ngspice to that exact `t`, quantizes, writes the register, and
  resumes — a just-in-time refresh that raises fidelity without shrinking the whole global
  step. This is the direct analogue of ADR-0018's "swap polling for GDB watchpoints to get
  edge-accuracy" future path, and is the recommended *second* increment.

Granularity is thus **not** a single magic number: it is a documented `cosimQuantumUs`
default (regime-dependent) plus a watchpoint fast-path. The MVP ships the fixed quantum;
the watchpoint refinement is flagged, not built.

---

## Q3 — GPIO_IN / ADC write mechanism

The GDB stub can **write** target memory (it is how a debugger sets variables) — RSP
`M addr,len:data` (hex) or `X addr,len:data` (binary). The current `gdb-rsp.ts` only builds
`m` *reads*; Direction B adds the symmetric seam.

### New seam (mirrors `MemoryReader`)

```
buildWriteMemoryPacket(address, length, value)   // "M<addr>,<len>:<hexdata>"
interface MemoryWriter { write(address, value, length?): Promise<void> }
class RspMemoryWriter implements MemoryWriter     // transport-injected, unit-testable
```

Plus an execution-control seam for the barrier (`vCont;c`/single-step/`?`), transport-
injected so the scheduler is testable with **zero QEMU** exactly like `pollGpio` today.

### Digital in → `GPIO_IN_REG` (0x3FF4403C, pins 0–31; `GPIO_IN1_REG` 0x3FF44040 for 32–39)

`GPIO_IN_REG` is read-only *to firmware* but externally writable via the stub. Because it
packs 32 pins, use **read-modify-write** so other pins are not clobbered: read the reg, set
or clear bit N per the threshold, write it back.

Thresholding with hysteresis (a real ESP32 input buffer is Schmitt-like):
`V > VIH (≈ 0.75·VDD ≈ 2.475 V) → 1`; `V < VIL (≈ 0.25·VDD ≈ 0.825 V) → 0`; in-between →
**hold the previous level**. Constants documented as bridge approximations (ADR-0013 stance).

### Analog in → ESP32 SAR ADC

Harder, and intentionally a **second increment**. The SAR ADC result is not a single stable
"input register" you can pre-write like `GPIO_IN`; a conversion is *triggered* and the code
latches in the `SENS_SAR_MEAS*` result registers. Design:

- **Transfer curve:** `code = round(4095 · clamp(V / Vfs, 0, 1))` for the channel's
  attenuation (`Vfs ≈ 1.1 V @0dB … ≈ 3.3 V @11dB`; the ESP32 curve is mildly nonlinear —
  document the linear approximation as a fidelity limit).
- **Where/when to write:** on the SAR-conversion trigger (detected via a write-watchpoint on
  the control register, or — MVP — just refresh the result reg every barrier). Writing the
  raw `SENS_SAR_MEAS1_DATA` field is emulator-version-sensitive, so ADC injection **needs a
  live-QEMU verification session** before it is trusted — flagged the same way ADR-0021
  deferred behaviors that require live-WASM/live-emulator confirmation (and the NE555).

**Recommendation:** ship **GPIO_IN digital-threshold injection as the lockstep MVP**
(complete, unit-testable against the injected transport); **ADC-result injection is designed
here but gated on a live-emulator verification increment.**

---

## Q4 — IR / mode shape for a lockstep qemu run

**No IR version bump.** Reuse what exists:

- **`simulationRun.engine: "qemu"`** — already in the enum (`simulation-run.ts` line 26).
- **`mode: "cosim"`** — `mode` is a free `z.string().min(1)`, so the new lockstep mode is a
  *string value*, not a schema change. This matches the reservation already written into
  `.context/firmware-in-the-loop.md`: `"live"` = Direction-A continuous poll, `"cosim"` =
  lockstep bidirectional. (Direction A stays mode `"live"`.)
- **`config`** for a cosim run carries the contract knobs:
  `{ mode: "cosim", quantumUs, durationUs, gpioMap?, adcMap? }`.
- **Bindings are derived, not duplicated** — same principle as ADR-0018. Input GPIO→net and
  ADC-channel→net come from the *same* `cmp_esp32_devkit` pin→net connections, read in the
  reverse direction. The additive, non-breaking escape hatch if a future part is ambiguous:
  optional `firmwareTarget.gpioMap?` / `adcMap?: Record<channel, netId>` (flagged, not built
  — exactly the `x_openbench_*` / `derivedParams` additive-without-bump precedent).
- **Result** stays `waveform-v1`: the co-simulated analog node set, optionally plus a
  digital trace of the injected input transitions. If a first-class digital-signal channel
  is later wanted, that is an additive `unit`/signal-kind — flagged, not required here.

So a lockstep run is: a `qemu`-engine `simulationRun`, `mode:"cosim"`, whose production is
driven by the `packages/cosim` scheduler. **Zero `packages/ir-schema` change** in this
spike or in the MVP.

---

## Non-goals (kept out on purpose)

- **Cycle-accurate mixed-signal / verification-grade timing.** The zero-order-hold barrier
  is a live-exploration tool, not a signed-off analog-digital timing run (ADR-0013 stance).
- **Optimistic / rollback co-sim** (Chandy–Misra, checkpoint+restore). Neither engine offers
  cheap state rollback; conservative lockstep is the pragmatic choice.
- **Full nonlinear ESP32 ADC modelling** and multi-channel SAR scheduling — linear transfer
  curve first, nonlinearity flagged.
- **Non-Xtensa MCUs.** ESP32/QEMU only; `renode` stays reserved for Phase-2 STM32 etc.
- Any **custom QEMU build or patched device** — stock `qemu-system-xtensa` with `-s -S
  -icount` only.

## Follow-up issues this finding enables (file, don't build here)

1. `feat` / `area:mcp-firmware` — **RSP write + exec-control seam**: `buildWriteMemoryPacket`,
   `MemoryWriter`/`RspMemoryWriter`, and a transport-injected execution controller
   (`continueFor`/`step`/`halt`). Acceptance: writing `GPIO_IN_REG` bit 4 via an injected
   transport emits the right `M3ff4403c,4:…` packet and round-trips through a fake stub;
   read-modify-write leaves other bits intact.
2. `feat` / `area:mcp-firmware` (likely a new `packages/cosim`) — **lockstep scheduler**:
   the fixed-quantum barrier loop over injected QEMU-exec + `MemoryReader`/`MemoryWriter` +
   an injected ngspice-step, with digital threshold+hysteresis. Acceptance: a fixture where
   a rising analog ramp crosses VIH flips `GPIO_IN` bit N exactly once, at the right
   quantum, with the emulator never more than Δt ahead of the analog step.
3. `spike` / `area:mcp-firmware` — **ADC result-register injection, live-QEMU verified**:
   confirm which `SENS_SAR_MEAS*` field to write and the attenuation transfer curve against
   a real `qemu-system-xtensa` run. Gated on a live-emulator session (ADR-0021 precedent).
4. `feat` / `area:frontend` — **live cosim mode**: expose `mode:"cosim"` behind the live
   view so a potentiometer/LDR voltage drives an emulated `digitalRead`/`analogRead` and the
   firmware's reaction animates on canvas.

Item 1 is the enabling seam; item 2 is the digital-in lockstep MVP; items 3–4 complete the
analog-in + UI story.
