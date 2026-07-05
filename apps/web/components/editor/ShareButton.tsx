"use client";

import React, { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { useEditorStore } from "../../lib/editor/store";
import { encodeShare, isShareError } from "../../lib/share";

type ShareStatus =
  | { kind: "copied"; url: string }
  | { kind: "too_large" }
  | { kind: "error" };

/**
 * Share action (issue #40): serializes the current project into a stateless,
 * compressed URL and copies an `/embed/<payload>` link to the clipboard. On an
 * oversized design it surfaces a "use file export" hint instead of throwing.
 */
export function ShareButton() {
  const bundle = useEditorStore((s) => s.bundle);
  const [status, setStatus] = useState<ShareStatus | null>(null);

  const share = async () => {
    if (!bundle) return;
    const result = await encodeShare(bundle);
    if (isShareError(result)) {
      setStatus({ kind: "too_large" });
      return;
    }
    const url = `${window.location.origin}/embed/${result}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus({ kind: "copied", url });
    } catch {
      // Clipboard denied (permissions / insecure context) — still show the URL.
      setStatus({ kind: "copied", url });
    }
  };

  return (
    <>
      <Button
        label="Share"
        size="sm"
        variant="ghost"
        isDisabled={!bundle}
        onClick={() => void share()}
      />
      {status?.kind === "copied" && (
        <div data-share-banner style={{ position: "absolute", zIndex: 1 }}>
          <Banner
            status="success"
            title="Embed link copied"
            description={status.url}
            isDismissable
            onDismiss={() => setStatus(null)}
          />
        </div>
      )}
      {status?.kind === "too_large" && (
        <div data-share-banner style={{ position: "absolute", zIndex: 1 }}>
          <Banner
            status="warning"
            title="Too large to share as a link"
            description="This design exceeds the URL size limit — use Export .kicad_sch to share a file instead."
            isDismissable
            onDismiss={() => setStatus(null)}
          />
        </div>
      )}
    </>
  );
}
