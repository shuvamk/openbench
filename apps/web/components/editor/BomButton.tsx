"use client";

import React, { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { useEditorStore } from "../../lib/editor/store";
import { BomPanel } from "./BomPanel";

/**
 * Top-bar entry point for the Bill of Materials (issue #39): opens the
 * project-wide BOM panel in an Astryx Dialog. Disabled until a project loads.
 */
export function BomButton() {
  const [isOpen, setIsOpen] = useState(false);
  const bundle = useEditorStore((s) => s.bundle);

  return (
    <>
      <Button
        label="Bill of Materials"
        size="sm"
        variant="ghost"
        isDisabled={!bundle}
        onClick={() => setIsOpen(true)}
      >
        BOM
      </Button>
      <Dialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        width={720}
        purpose="info"
        aria-label="Bill of Materials"
      >
        <div style={{ padding: 16, boxSizing: "border-box" }}>
          <BomPanel />
        </div>
      </Dialog>
    </>
  );
}
