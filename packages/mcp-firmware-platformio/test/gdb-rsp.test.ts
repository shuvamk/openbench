import { describe, expect, it } from "vitest";
import {
  RspMemoryReader,
  buildReadMemoryPacket,
  frame,
  parseMemoryResponse,
  rspChecksum,
  type RspTransport,
} from "../src/index";

/**
 * Acceptance tests for issue #64 (firmware-in-the-loop step 1) — the thin
 * GDB Remote Serial Protocol client used to read memory-mapped registers out
 * of the QEMU esp32 machine over its `-s` GDB server.
 *
 * These are pure protocol-codec tests plus a transport-injected reader; no
 * real QEMU process is launched (that is wired at the MCP-server layer).
 */
describe("GDB-RSP codec", () => {
  it("computes the modulo-256 checksum of a packet payload as two lowercase hex digits", () => {
    // GDB's canonical example: checksum of "OK" is 0x9a.
    expect(rspChecksum("OK")).toBe("9a");
    // Empty payload → 0x00.
    expect(rspChecksum("")).toBe("00");
  });

  it("frames a payload as $<payload>#<checksum>", () => {
    expect(frame("OK")).toBe("$OK#9a");
  });

  it("builds an `m addr,length` memory-read packet with hex address and length", () => {
    // GPIO_OUT_REG = 0x3FF44004, 4 bytes.
    expect(buildReadMemoryPacket(0x3ff44004, 4)).toBe("$m3ff44004,4#" + rspChecksum("m3ff44004,4"));
  });

  it("parses a little-endian 32-bit word out of an `m` hex-byte response", () => {
    // ESP32 is little-endian: bytes 04 00 f4 3f -> 0x3ff40004.
    expect(parseMemoryResponse("0400f43f")).toBe(0x3ff40004);
    // A single set bit in the low byte.
    expect(parseMemoryResponse("04000000")).toBe(0x00000004);
  });

  it("throws on an RSP error response (E<nn>) instead of returning garbage", () => {
    expect(() => parseMemoryResponse("E01")).toThrowError(/rsp error/i);
  });
});

describe("RspMemoryReader", () => {
  it("reads a 32-bit word by sending an `m` packet and decoding the reply", async () => {
    const seen: string[] = [];
    const transport: RspTransport = {
      async request(packet: string) {
        seen.push(packet);
        // Reply with 0x00000004 little-endian for any address.
        return "04000000";
      },
    };
    const reader = new RspMemoryReader(transport);
    const word = await reader.readWord(0x3ff44004);

    expect(word).toBe(0x00000004);
    expect(seen).toEqual([buildReadMemoryPacket(0x3ff44004, 4)]);
  });
});
