"use client";

import React, { useMemo, useState } from "react";
import { decodeSamples, isSpiceTimeValue } from "@openbench/mcp-sim-ngspice";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import { useEditorStore } from "../../lib/editor/store";
import { defaultProbeNetIds } from "../../lib/sim/run";
import { useSimStore } from "../../lib/sim/store";
import { WaveformViewer, type WaveformTrace } from "./WaveformViewer";

const PANEL_HEIGHT = 280;

function timeInputStatus(value: string): { type: "error"; message: string } | undefined {
  return isSpiceTimeValue(value)
    ? undefined
    : { type: "error", message: "Use a SPICE time value like 10ms or 1us" };
}

/** Simulation tab: transient controls + probe selection + the waveform plot. */
function SimulationTab() {
  const bundle = useEditorStore((s) => s.bundle);
  const duration = useSimStore((s) => s.duration);
  const step = useSimStore((s) => s.step);
  const probes = useSimStore((s) => s.probes);
  const status = useSimStore((s) => s.status);
  const run = useSimStore((s) => s.run);
  const hiddenTraceIds = useSimStore((s) => s.hiddenTraceIds);
  const setDuration = useSimStore((s) => s.setDuration);
  const setStep = useSimStore((s) => s.setStep);
  const setProbes = useSimStore((s) => s.setProbes);
  const toggleTrace = useSimStore((s) => s.toggleTrace);
  const runSimulation = useSimStore((s) => s.runSimulation);

  const schematic = bundle?.schematic;
  const selectedProbes = useMemo(
    () => probes ?? (schematic ? defaultProbeNetIds(schematic) : []),
    [probes, schematic],
  );

  const { time, traces } = useMemo((): { time?: Float64Array; traces: WaveformTrace[] } => {
    if (run?.results === undefined) return { traces: [] };
    const nameByNetId = new Map(
      (schematic?.nets ?? []).map((net) => [net.netId, net.name ?? net.netId]),
    );
    let time: Float64Array | undefined;
    const traces: WaveformTrace[] = [];
    for (const signal of run.results.signals) {
      try {
        const values = decodeSamples(signal.samples);
        if (signal.netId === "time") time = values;
        else
          traces.push({
            id: signal.netId,
            label: nameByNetId.get(signal.netId) ?? signal.netId,
            unit: signal.unit,
            values,
          });
      } catch {
        // Remote / undecodable samples are valid IR — skip them in the plot.
      }
    }
    return { time, traces };
  }, [run, schematic]);

  const isRunning = status === "queued" || status === "running";
  const isValid = isSpiceTimeValue(duration) && isSpiceTimeValue(step);

  return (
    <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0, padding: "8px 12px" }}>
      <div style={{ width: 230, flexShrink: 0, overflowY: "auto" }}>
        <VStack gap={2}>
          <TextInput
            label="Duration"
            size="sm"
            value={duration}
            onChange={setDuration}
            status={timeInputStatus(duration)}
          />
          <TextInput
            label="Step"
            size="sm"
            value={step}
            onChange={setStep}
            status={timeInputStatus(step)}
          />
          <div data-testid="sim-probes">
            <CheckboxList
              label="Probes"
              density="compact"
              value={selectedProbes}
              onChange={(values) => setProbes(values)}
            >
              {(schematic?.nets ?? []).map((net) => (
                <CheckboxListItem
                  key={net.netId}
                  label={net.name ?? net.netId}
                  value={net.netId}
                />
              ))}
            </CheckboxList>
          </div>
          <Button
            label="Run simulation"
            variant="primary"
            size="sm"
            isLoading={isRunning}
            isDisabled={!isValid || !bundle || selectedProbes.length === 0}
            onClick={() => void runSimulation()}
          >
            ▶ Run
          </Button>
        </VStack>
      </div>
      <WaveformViewer
        time={time}
        traces={traces}
        hiddenTraceIds={hiddenTraceIds}
        onToggleTrace={toggleTrace}
      />
    </div>
  );
}

/** Console tab: the SPICE deck plus a monospace log of warnings and errors. */
function ConsoleTab() {
  const deck = useSimStore((s) => s.deck);
  const consoleEntries = useSimStore((s) => s.consoleEntries);

  const log = consoleEntries.map((entry) => `[${entry.level}] ${entry.text}`).join("\n");

  return (
    <div
      data-testid="sim-console"
      style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 12px" }}
    >
      {consoleEntries.length === 0 && deck === undefined ? (
        <Text type="supporting" color="secondary">
          No console output yet — run a simulation.
        </Text>
      ) : (
        <VStack gap={2}>
          {log.length > 0 && (
            <CodeBlock code={log} language="plaintext" width="100%" hasCopyButton={false} />
          )}
          {deck !== undefined && (
            <CodeBlock code={deck} language="plaintext" title="SPICE deck" width="100%" />
          )}
        </VStack>
      )}
    </div>
  );
}

/** Firmware tab: Phase 1 firmware builds happen through the local adapter. */
function FirmwareTab() {
  const firmwareTarget = useEditorStore((s) => s.bundle?.firmwareTarget);

  return (
    <div
      data-testid="sim-firmware"
      style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 12px" }}
    >
      <VStack gap={2}>
        <Banner
          status="info"
          title="Firmware builds run locally in Phase 1"
          description="Building and flashing firmware happens through the local PlatformIO adapter (@openbench/mcp-firmware-platformio) — not in the browser yet. Point it at this project to build and flash a virtual MCU."
        />
        {firmwareTarget !== undefined && (
          <VStack gap={0.5}>
            <Text type="label" color="secondary">
              Current firmware target
            </Text>
            <Text type="supporting" color="secondary">
              {`${firmwareTarget.mcu} · ${firmwareTarget.framework} · build ${firmwareTarget.buildStatus}`}
            </Text>
          </VStack>
        )}
      </VStack>
    </div>
  );
}

/**
 * Bottom dock (issue #13): Simulation | Console | Firmware tabs above a
 * ~280px panel. Fed entirely by the sim store + the editor's IR bundle.
 */
export function SimPanel() {
  const [tab, setTab] = useState("simulation");

  return (
    <div
      style={{
        height: PANEL_HEIGHT,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid var(--ob-canvas-grid)",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <TabList value={tab} onChange={setTab} size="sm" hasDivider>
        <Tab value="simulation" label="Simulation" />
        <Tab value="console" label="Console" />
        <Tab value="firmware" label="Firmware" />
      </TabList>
      {tab === "simulation" && <SimulationTab />}
      {tab === "console" && <ConsoleTab />}
      {tab === "firmware" && <FirmwareTab />}
    </div>
  );
}
