import type { Netlist } from "@openbench/ir-schema";

/**
 * Hand-built netlist IR fixture (issue #9): a 5V source driving an RC divider.
 * Mirrors the netlist example in .context/interchange-format.md — three nets
 * (vin, vout, gnd where gnd is spice node "0") and three elements.
 */
export const rcNetlist: Netlist = {
  irVersion: "0.1.0",
  kind: "netlist",
  id: "net_fixture_rc",
  schematicId: "sch_fixture_rc",
  nodes: [
    { netId: "net_vin", spiceNode: "1" },
    { netId: "net_vout", spiceNode: "2" },
    { netId: "net_gnd", spiceNode: "0" },
  ],
  elements: [
    { instanceId: "V1", spiceCard: "V1 1 0 DC 5" },
    { instanceId: "R1", spiceCard: "R1 1 2 1k" },
    { instanceId: "C1", spiceCard: "C1 2 0 1u" },
  ],
  derivedBy: "netlist-compiler@0.1.0",
  provenance: { source: "ir-core", at: "2026-07-02T00:00:00Z" },
};

export const transientConfig = { duration: "10ms", step: "1us" };
