import { NgspiceAdapterError } from "./deck";

/**
 * Waveform sample encoding per ADR-0007: inline-first base64 Float64
 * (`data:` URI) with a URL escape hatch. Base64 is implemented by hand so
 * the module is byte-identical in node and the browser (no Buffer, no
 * atob/btoa dependency) — this package runs in both (ADR-0006).
 */

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const SAMPLES_PREFIX = "data:application/octet-stream;base64,";
const REMOTE_SCHEMES = /^(https?|s3):\/\//i;

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64_ALPHABET.charAt(b0 >> 2);
    out += B64_ALPHABET.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? B64_ALPHABET.charAt(((b1 & 0x0f) << 2) | (b2 >> 6)) : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET.charAt(b2 & 0x3f) : "=";
  }
  return out;
}

function base64ToBytes(text: string, path: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) {
    throw new NgspiceAdapterError("samples payload is not valid base64", [
      { path, message: "samples payload is not valid base64" },
    ]);
  }
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let accBits = 0;
  let offset = 0;
  for (const char of clean) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(char);
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      bytes[offset++] = (acc >> accBits) & 0xff;
    }
  }
  return bytes;
}

/** Encode waveform samples as an inline data: URI (little-endian float64). */
export function encodeSamples(samples: Float64Array): string {
  const bytes = new Uint8Array(samples.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    view.setFloat64(i * 8, samples[i]!, true);
  }
  return SAMPLES_PREFIX + bytesToBase64(bytes);
}

/**
 * Decode inline samples back to a Float64Array. Remote URLs (http/https/s3)
 * are valid IR (ADR-0007) but cannot be resolved by this adapter — they throw
 * a clear pass-through error instead of a decode failure.
 */
export function decodeSamples(samples: string): Float64Array {
  if (REMOTE_SCHEMES.test(samples)) {
    throw new NgspiceAdapterError(
      `remote samples not fetchable here: ${samples} (only inline data: URIs are decodable in this adapter)`,
      [{ path: "samples", message: `remote samples not fetchable here: ${samples}` }],
    );
  }
  const commaIndex = samples.indexOf(",");
  if (!samples.toLowerCase().startsWith("data:") || commaIndex === -1 || !/;base64,/i.test(samples)) {
    throw new NgspiceAdapterError("samples must be a base64 data: URI", [
      { path: "samples", message: "samples must be a base64 data: URI" },
    ]);
  }
  const bytes = base64ToBytes(samples.slice(commaIndex + 1), "samples");
  if (bytes.length % 8 !== 0) {
    throw new NgspiceAdapterError(
      `samples payload is ${bytes.length} bytes — not a whole number of float64 values`,
      [{ path: "samples", message: `payload is ${bytes.length} bytes, expected a multiple of 8` }],
    );
  }
  const out = new Float64Array(bytes.length / 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getFloat64(i * 8, true);
  }
  return out;
}

/** Encode a text log inline (data:text/plain) — used for failed-run logs. */
export function encodeTextAsDataUri(text: string): string {
  return `data:text/plain;base64,${bytesToBase64(new TextEncoder().encode(text))}`;
}
