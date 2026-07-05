import type { ProjectBundle } from "./project-store/types";

/**
 * Stateless sharing (issue #40): a project bundle is serialized into a
 * gzip-compressed, URL-safe base64 payload that rides entirely in the URL —
 * no server, no DB, no account (ADR-0008). `/embed/<payload>` hydrates a
 * read-only project from it. This is NOT multiplayer/CRDT (that stays Phase 2).
 */

/**
 * Conservative cap on the encoded payload length. Real browsers accept far more,
 * but intermediaries (proxies, some chat/forum link parsers) choke past ~8k, and
 * a link that big belongs in a file export anyway. Encoded chars, not raw bytes.
 */
export const SHARE_URL_LIMIT = 8000;

export interface ShareError {
  ok: false;
  error: "too_large";
  /** Encoded payload length that overran the cap. */
  size: number;
  limit: number;
}

/** Type guard: did `encodeShare` decline (vs. return a payload string)? */
export function isShareError(value: string | ShareError): value is ShareError {
  return typeof value !== "string";
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  void writer.write(new TextEncoder().encode(text));
  void writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  // Copy into a fresh ArrayBuffer-backed view so the chunk is a `BufferSource`
  // under TS's stricter Uint8Array<ArrayBuffer> typing.
  void writer.write(new Uint8Array(bytes));
  void writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // Chunk to stay under the argument-count limit of String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(payload: string): Uint8Array {
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Compress + URL-safe-encode a bundle. Returns the payload string on success,
 * or a structured `ShareError` when it exceeds {@link SHARE_URL_LIMIT}. Never
 * throws for the oversized case — the caller falls back to file export.
 */
export async function encodeShare(
  bundle: ProjectBundle,
): Promise<string | ShareError> {
  const bytes = await gzip(JSON.stringify(bundle));
  const payload = toBase64Url(bytes);
  if (payload.length > SHARE_URL_LIMIT) {
    return { ok: false, error: "too_large", size: payload.length, limit: SHARE_URL_LIMIT };
  }
  return payload;
}

/** Inverse of {@link encodeShare}: decode + decompress + parse a payload. */
export async function decodeShare(payload: string): Promise<ProjectBundle> {
  const json = await gunzip(fromBase64Url(payload));
  return JSON.parse(json) as ProjectBundle;
}
