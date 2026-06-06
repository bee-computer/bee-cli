import { describe, expect, it } from "bun:test";
import {
  formatAiDateTime,
  formatDateValue,
  formatRecordMarkdown,
} from "./markdown";

describe("formatAiDateTime", () => {
  const timeZone = "UTC";
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);

  it("formats seconds, minutes, hours, and days with suffixes", () => {
    const cases: Array<{ offsetMs: number; expected: string }> = [
      { offsetMs: 30 * 1000, expected: "30 seconds ago" },
      { offsetMs: 2 * 60 * 1000, expected: "2 minutes ago" },
      { offsetMs: 3 * 60 * 60 * 1000, expected: "3 hours ago" },
      { offsetMs: 5 * 24 * 60 * 60 * 1000, expected: "5 days ago" },
    ];

    for (const { offsetMs, expected } of cases) {
      const nowMs = base + offsetMs;
      const formatted = formatAiDateTime(base, timeZone, nowMs);
      expect(formatted).toBe(`2024-01-01 00:00 [${expected}]`);
    }
  });
});

describe("formatDateValue bare calendar dates (H7)", () => {
  const timeZone = "America/Los_Angeles";
  // 2026-06-06 12:00 local time.
  const nowMs = Date.UTC(2026, 5, 6, 19, 0, 0);

  it("renders a bare YYYY-MM-DD literally without timezone shift", () => {
    expect(formatDateValue("2026-06-06", timeZone, nowMs)).toBe("2026-06-06 [today]");
  });

  it("renders a non-today bare date literally without a today suffix", () => {
    expect(formatDateValue("2026-06-05", timeZone, nowMs)).toBe("2026-06-05");
  });

  it("still timezone-converts full ISO timestamps", () => {
    const result = formatDateValue("2026-06-06T19:00:00Z", timeZone, nowMs);
    expect(result).toContain("2026-06-06 12:00");
    expect(result).toContain("[");
  });
});

describe("formatRecordMarkdown list-of-objects rendering (H6)", () => {
  const timeZone = "UTC";
  const nowMs = Date.UTC(2024, 0, 1, 0, 0, 0);

  it("renders an array of objects as per-item blocks instead of one inline line", () => {
    const output = formatRecordMarkdown({
      title: "Recent Activity",
      record: {
        activity: [
          { id: 1, type: "conversation", state: "CAPTURING" },
          { id: 2, type: "insight", title: "Something" },
        ],
      },
      timeZone,
      nowMs,
    });

    expect(output).toContain("- activity:");
    expect(output).toContain("  1.");
    expect(output).toContain("     - id: 1");
    expect(output).toContain("     - state: CAPTURING");
    expect(output).toContain("  2.");
    expect(output).toContain("     - title: Something");
    // The old behavior joined items with " | " on a single line.
    expect(output).not.toContain(" | ");
  });

  it("keeps arrays of primitives inline", () => {
    const output = formatRecordMarkdown({
      title: "Tags",
      record: { tags: ["a", "b", "c"] },
      timeZone,
      nowMs,
    });

    expect(output).toContain("- tags: a, b, c");
  });

  it("keeps scalar fields inline as before", () => {
    const output = formatRecordMarkdown({
      title: "Profile",
      record: { first_name: "Ethan", last_name: "Sutin" },
      timeZone,
      nowMs,
    });

    expect(output).toContain("- first_name: Ethan");
    expect(output).toContain("- last_name: Sutin");
  });
});
