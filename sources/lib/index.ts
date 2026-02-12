import type { BeeCliOptions } from "@/lib/types";
import type { AuthApi } from "@/lib/auth";
import type { DataApi } from "@/lib/api";
import type { SseApi } from "@/lib/sse";
import type { BeeCliRunner } from "@/lib/runner";
import { createAuthApi } from "@/lib/auth";
import { createDataApi } from "@/lib/api";
import { createBeeCliRunner } from "@/lib/runner";
import { createSseApi, createJsonSseStream } from "@/lib/sse";

export type { BeeCliOptions, BeeEnvironment } from "@/lib/types";
export type { AuthApi } from "@/lib/auth";
export type { DataApi } from "@/lib/api";
export type {
  JsonSseEvent,
  JsonSseStream,
  SseApi,
} from "@/lib/sse";
export type { BeeCliRunner, BeeSubprocess } from "@/lib/runner";

export type BeeClient = {
  auth: AuthApi;
  api: DataApi;
  sse: SseApi;
  run: BeeCliRunner["run"];
  runJson: BeeCliRunner["runJson"];
};

export function createBeeClient(options: BeeCliOptions = {}): BeeClient {
  const runner = createBeeCliRunner(options);
  return {
    auth: createAuthApi(runner),
    api: createDataApi(runner),
    sse: createSseApi(runner),
    run: runner.run,
    runJson: runner.runJson,
  };
}

export { createBeeCliRunner, createJsonSseStream };
