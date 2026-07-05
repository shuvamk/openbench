"use client";

import React, { use } from "react";
import { EmbedSimulator } from "../../../components/embed/EmbedSimulator";

/**
 * Embeddable simulator route (issue #40): `/embed/<payload>` where `<payload>`
 * is the URL-safe, compressed project bundle from `encodeShare`. Stateless —
 * the whole design lives in the URL; nothing is fetched from a server or DB.
 */
export default function EmbedPage({
  params,
}: {
  params: Promise<{ payload: string }>;
}) {
  const { payload } = use(params);
  return <EmbedSimulator payload={payload} />;
}
