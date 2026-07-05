"use client";

import React, { useMemo } from "react";
import { getComponent } from "@openbench/registry";
import { Button } from "@astryxdesign/core/Button";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { useEditorStore } from "../../lib/editor/store";
import { buildBom, bomToCsv, type BomLine } from "../../lib/bom";

/** Trigger a browser download (same Blob + anchor pattern as the top bar). */
function downloadText(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Display name for a component id — its registry name, or the raw id if unknown. */
function partName(componentId: string): string {
  return getComponent(componentId)?.name ?? componentId;
}

interface BomRow extends Record<string, unknown> {
  id: string;
  ref: string;
  part: string;
  value: string;
  qty: number;
  footprint: string;
}

function toRow(line: BomLine): BomRow {
  return {
    id: line.refs.join(";"),
    ref: line.refs.join(";"),
    part: partName(line.componentId),
    value: line.value || "—",
    qty: line.qty,
    footprint: line.unknown ? "⚠ unknown" : (line.footprint ?? "—"),
  };
}

const COLUMNS = [
  { key: "ref", header: "Refs", width: proportional(1.5) },
  { key: "part", header: "Part", width: proportional(1.5) },
  { key: "value", header: "Value", width: proportional(1) },
  { key: "qty", header: "Qty", width: pixel(64), align: "end" as const },
  { key: "footprint", header: "Footprint", width: proportional(2) },
];

/**
 * Bill of Materials panel (issue #39): a pure projection of the schematic IR
 * into a purchasable, grouped parts table (Astryx Table) with a one-click CSV
 * export, plus a "virtual" section for footprint-less parts (ground, sources).
 */
export function BomPanel() {
  const bundle = useEditorStore((s) => s.bundle);
  const schematic = bundle?.schematic;

  const bom = useMemo(
    () => (schematic ? buildBom(schematic) : { lines: [], virtual: [] }),
    [schematic],
  );

  const rows = useMemo(() => bom.lines.map(toRow), [bom.lines]);
  const virtualRows = useMemo(() => bom.virtual.map(toRow), [bom.virtual]);

  const exportCsv = () => {
    const base = (bundle?.project.name ?? "bom").replace(/[^\w.-]+/g, "_");
    downloadText(`${base}-bom.csv`, bomToCsv(bom.lines), "text/csv");
  };

  return (
    <VStack gap={4}>
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <Text type="label" color="secondary">
            Bill of Materials
          </Text>
        </StackItem>
        <StackItem size="static">
          <Button
            label="Export CSV"
            size="sm"
            variant="secondary"
            isDisabled={bom.lines.length === 0}
            onClick={exportCsv}
          />
        </StackItem>
      </HStack>

      {rows.length === 0 ? (
        <Text type="supporting" color="secondary">
          No purchasable parts yet — add components to build a BOM.
        </Text>
      ) : (
        <Table<BomRow> data={rows} columns={COLUMNS} idKey="id" density="compact" />
      )}

      {virtualRows.length > 0 && (
        <VStack gap={1.5}>
          <Text type="label" color="secondary">
            Virtual (not purchasable)
          </Text>
          <Table<BomRow>
            data={virtualRows}
            columns={COLUMNS.filter((c) => c.key !== "footprint")}
            idKey="id"
            density="compact"
          />
        </VStack>
      )}
    </VStack>
  );
}
