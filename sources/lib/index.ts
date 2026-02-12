import type { BeeCliOptions } from "./types";
import type { AuthApi } from "./auth";
import type { DataApi } from "./api";
import type { SseApi } from "./sse";
import type { BeeCliRunner } from "./runner";
import { createAuthApi } from "./auth";
import { createDataApi } from "./api";
import { createBeeCliRunner } from "./runner";
import { createSseApi, createJsonSseStream } from "./sse";

export type { BeeCliOptions, BeeEnvironment } from "./types";
export type { AuthApi } from "./auth";
export type { DataApi } from "./api";
export type {
  JsonSseEvent,
  JsonSseStream,
  SseApi,
} from "./sse";
export type { BeeCliRunner, BeeSubprocess } from "./runner";

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
