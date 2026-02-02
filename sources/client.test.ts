import { describe, expect, it } from "bun:test";
import { createDeveloperClient } from "@/client";
import { getEnvironmentConfig, type Environment } from "@/environment";

const TIMEOUT_MS = 5000;

async function expectFetch(env: Environment): Promise<void> {
  const config = getEnvironmentConfig(env);
  const client = createDeveloperClient(env);
  const response = await client.fetch("/v1/me", {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(600);
  expect(response.url.startsWith(config.apiUrl)).toBe(true);
}

describe("developer client", () => {
  it("fetches production endpoint", async () => {
    await expectFetch("prod");
  });

  it("fetches staging endpoint", async () => {
    await expectFetch("staging");
  });
});
