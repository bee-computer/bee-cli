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
    "runs against real bee binary with authenticated profile",
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
      expect(status.stdout).toContain("Verified as");

      const profile = await bee.api.me<{
        id?: number;
        first_name?: string;
        last_name?: string | null;
        timezone?: string | null;
      }>();

      expect(typeof profile).toBe("object");
      expect(typeof profile?.id).toBe("number");
      expect(typeof profile?.first_name).toBe("string");
    },
    TIMEOUT_MS
  );
});
