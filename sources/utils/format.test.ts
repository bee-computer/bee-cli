import { describe, expect, it } from "bun:test";
import { resolveOutputFormat } from "./format";

describe("resolveOutputFormat", () => {
  it("defaults to text when no flag or env", () => {
    const original = process.env["BEE_OUTPUT_FORMAT"];
    delete process.env["BEE_OUTPUT_FORMAT"];
    const { format, args } = resolveOutputFormat(["list", "--limit", "5"]);
    expect(format).toBe("text");
    expect(args).toEqual(["list", "--limit", "5"]);
    if (original) process.env["BEE_OUTPUT_FORMAT"] = original;
  });

  it("detects --json flag", () => {
    const { format, args } = resolveOutputFormat(["list", "--json", "--limit", "5"]);
    expect(format).toBe("json");
    expect(args).toEqual(["list", "--limit", "5"]);
  });

  it("detects --pretty flag", () => {
    const { format, args } = resolveOutputFormat(["list", "--pretty"]);
    expect(format).toBe("text");
    expect(args).toEqual(["list"]);
  });

  it("detects --minimal flag", () => {
    const { format, args } = resolveOutputFormat(["--minimal", "list"]);
    expect(format).toBe("minimal");
    expect(args).toEqual(["list"]);
  });

  it("detects --format json", () => {
    const { format, args } = resolveOutputFormat(["--format", "json", "list"]);
    expect(format).toBe("json");
    expect(args).toEqual(["list"]);
  });

  it("flag takes precedence over env var", () => {
    const original = process.env["BEE_OUTPUT_FORMAT"];
    process.env["BEE_OUTPUT_FORMAT"] = "json";
    const { format } = resolveOutputFormat(["--pretty", "list"]);
    expect(format).toBe("text");
    if (original) process.env["BEE_OUTPUT_FORMAT"] = original;
    else delete process.env["BEE_OUTPUT_FORMAT"];
  });

  it("reads BEE_OUTPUT_FORMAT env var", () => {
    const original = process.env["BEE_OUTPUT_FORMAT"];
    process.env["BEE_OUTPUT_FORMAT"] = "minimal";
    const { format } = resolveOutputFormat(["list"]);
    expect(format).toBe("minimal");
    if (original) process.env["BEE_OUTPUT_FORMAT"] = original;
    else delete process.env["BEE_OUTPUT_FORMAT"];
  });
});
