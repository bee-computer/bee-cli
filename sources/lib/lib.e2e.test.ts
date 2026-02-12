import { describe, expect, it } from "bun:test";
import { createBeeClient } from "@/lib";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SHOULD_RUN = process.env["BEE_CLI_E2E"] === "1";
const e2e = SHOULD_RUN ? it : it.skip;
const TIMEOUT_MS = 20000;

const binaryPath = resolve(process.cwd(), "dist", "bee");

describe("bee cli e2e", () => {
  e2e(
    "runs against real bee binary",
    async () => {
      if (!existsSync(binaryPath)) {
        throw new Error(
          `Bee binary not found at ${binaryPath}. Run bun run build first.`
        );
      }

      const bee = createBeeClient({ command: binaryPath });
      const version = await bee.api.version<{ name?: string; version?: string }>();

      expect(typeof version).toBe("object");
      expect(typeof version?.version).toBe("string");

      const status = await bee.run(["status"]);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("API:");
      expect(
        status.stdout.includes("Not logged in.") ||
          status.stdout.includes("Verified as")
      ).toBe(true);
    },
    TIMEOUT_MS
  );
});
