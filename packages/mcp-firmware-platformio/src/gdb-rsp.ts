/**
 * Thin GDB Remote Serial Protocol (RSP) client — firmware-in-the-loop step 1
 * (issue #64).
 *
 * The QEMU esp32 machine (see machine.ts) is launched with `-s`, exposing a
 * GDB stub on tcp::1234. To observe firmware behaviour we don't need a full
 * debugger — only the ability to read memory-mapped GPIO registers. This
 * module is the smallest slice of RSP that does that: packet framing +
 * checksum, an `m addr,len` memory-read builder, a little-endian word decoder,
 * and a transport-injected {@link RspMemoryReader}.
 *
 * The transport (socket framing, `+`/`-` acks, retransmit) is intentionally
 * left as an injectable seam ({@link RspTransport}) so the codec stays pure and
 * testable without a live QEMU process; the concrete socket transport is wired
 * at the MCP-server layer.
 */

/** A duplex link to the GDB stub: send a framed packet, get back its payload. */
export interface RspTransport {
  /**
   * Send a fully framed RSP packet (`$...#cs`) and resolve with the *payload*
   * of the reply (the bytes between `$` and `#`, acks and framing stripped).
   */
  request(packet: string): Promise<string>;
}

/** Reads fixed-width words out of target memory. */
export interface MemoryReader {
  /** Read a little-endian 32-bit word at `address`. */
  readWord(address: number): Promise<number>;
}

/**
 * The RSP packet checksum: the sum of the payload's byte values modulo 256,
 * rendered as two lowercase hex digits (GDB's canonical `$OK#9a`).
 */
export function rspChecksum(payload: string): string {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum = (sum + payload.charCodeAt(i)) & 0xff;
  }
  return sum.toString(16).padStart(2, "0");
}

/** Frame a payload as a complete RSP packet: `$<payload>#<checksum>`. */
export function frame(payload: string): string {
  return `$${payload}#${rspChecksum(payload)}`;
}

/**
 * Build an `m addr,length` memory-read packet (framed). Address and length are
 * hex with no `0x` prefix, per the RSP spec.
 */
export function buildReadMemoryPacket(address: number, length: number): string {
  return frame(`m${address.toString(16)},${length.toString(16)}`);
}

/**
 * Decode the payload of an `m` reply — a run of hex byte pairs in target
 * (little-endian, for the esp32) memory order — into an unsigned 32-bit word.
 * An RSP error reply (`E<nn>`) throws rather than decoding to garbage.
 */
export function parseMemoryResponse(payload: string): number {
  if (/^E[0-9a-fA-F]{2}$/.test(payload)) {
    throw new Error(`RSP error response: ${payload}`);
  }
  if (payload.length === 0 || payload.length % 2 !== 0) {
    throw new Error(`malformed RSP memory response: ${JSON.stringify(payload)}`);
  }
  let word = 0;
  for (let i = 0; i < payload.length; i += 2) {
    const byte = parseInt(payload.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`malformed RSP memory response: ${JSON.stringify(payload)}`);
    }
    // Little-endian: byte i is the (i/2)-th least-significant byte.
    word |= byte << (4 * i);
  }
  return word >>> 0;
}

/**
 * A {@link MemoryReader} backed by an RSP transport: each read sends an
 * `m addr,4` packet and decodes the little-endian reply.
 */
export class RspMemoryReader implements MemoryReader {
  constructor(private readonly transport: RspTransport) {}

  async readWord(address: number): Promise<number> {
    const payload = await this.transport.request(buildReadMemoryPacket(address, 4));
    return parseMemoryResponse(payload);
  }
}
