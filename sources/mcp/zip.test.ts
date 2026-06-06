import { describe, expect, it } from "bun:test";
import { crc32, writeZip } from "@/mcp/zip";

describe("MCP zip", () => {
  it("computes the known CRC32 vector for \"123456789\"", () => {
    // Standard CRC-32 (IEEE 802.3) check value for the ASCII string "123456789".
    expect(crc32(Buffer.from("123456789", "ascii"))).toBe(0xcbf43926);
  });

  it("computes CRC32 of 0 for empty input", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it("round-trips identical CRC32 values for identical data", () => {
    const left = crc32(Buffer.from("hello bee", "utf8"));
    const right = crc32(Buffer.from("hello bee", "utf8"));
    expect(left).toBe(right);
    expect(crc32(Buffer.from("hello bee!", "utf8"))).not.toBe(left);
  });

  it("writes a buffer starting with the PK local-file-header signature", () => {
    const zip = writeZip([{ name: "a.txt", data: Buffer.from("hi", "utf8") }]);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("ends with the end-of-central-directory signature and entry counts", () => {
    const zip = writeZip([
      { name: "a.txt", data: Buffer.from("one", "utf8") },
      { name: "b.txt", data: Buffer.from("two", "utf8") },
    ]);
    const end = zip.subarray(zip.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(8)).toBe(2);
    expect(end.readUInt16LE(10)).toBe(2);
  });
});
