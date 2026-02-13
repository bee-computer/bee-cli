import type { BeeCliOptions } from "./types.js";
import type { AuthApi } from "./auth.js";
import type { DataApi } from "./api.js";
import type { SseApi } from "./sse.js";
import type { BeeCliRunner } from "./runner.js";
import { createAuthApi } from "./auth.js";
import { createDataApi } from "./api.js";
import { createBeeCliRunner } from "./runner.js";
import { createSseApi, createJsonSseStream } from "./sse.js";

export type { BeeCliOptions, BeeEnvironment } from "./types.js";
export type { AuthApi } from "./auth.js";
export type { DataApi } from "./api.js";
export type {
  JsonSseEvent,
  JsonSseStream,
  SseApi,
} from "./sse.js";
export type { BeeCliRunner, BeeSubprocess } from "./runner.js";

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
