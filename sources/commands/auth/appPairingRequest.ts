import type { Environment } from "@/environment";

export type AppPairingRequest =
  | { status: "pending"; requestId: string; expiresAt: string }
  | { status: "completed"; requestId: string; encryptedToken: string }
  | { status: "expired"; requestId: string };

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerError";
  }
}

const PAIRING_API_URLS: Record<Environment, string> = {
  prod: "https://auth.beeai-services.com",
  staging: "https://public-api.korshaks.people.amazon.dev",
};

const PAIRING_PATH = "/apps/pairing/request";
const MAX_RETRIES = 10;
const MAX_BACKOFF_MS = 30000;

export async function requestAppPairing(
  env: Environment,
  appId: string,
  publicKey: string,
  signal?: AbortSignal
): Promise<AppPairingRequest> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_id: appId, publicKey }),
  };
  if (signal) {
    init.signal = signal;
  }

  const response = await fetchPairing(env, init);

  if (!response.ok) {
    const errorPayload = await safeJson(response);
    const errorCode =
      typeof errorPayload?.["error"] === "string" ? errorPayload["error"] : null;
    if (response.status === 404 && (!errorCode || errorCode === "Not Found")) {
      throw new Error("Pairing endpoint not found.");
    }

    const message = errorCode ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  const data = await safeJson(response);
  if (data?.["ok"] !== true) {
    throw new Error("Invalid response from developer API.");
  }

  const status = data?.["status"];
  const requestId = data?.["requestId"];

  if (status === "pending") {
    const expiresAt = data?.["expiresAt"];
    if (typeof requestId !== "string" || typeof expiresAt !== "string") {
      throw new Error("Invalid response from developer API.");
    }
    return { status: "pending", requestId, expiresAt };
  }

  if (status === "completed") {
    const result = data?.["result"];
    const encryptedToken =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)["encryptedToken"]
        : null;
    if (typeof requestId !== "string" || typeof encryptedToken !== "string") {
      throw new Error("Invalid response from developer API.");
    }
    return { status: "completed", requestId, encryptedToken };
  }

  if (status === "expired") {
    if (typeof requestId !== "string") {
      throw new Error("Invalid response from developer API.");
    }
    return { status: "expired", requestId };
  }

  throw new Error("Invalid response from developer API.");
}

async function fetchPairing(
  env: Environment,
  init: RequestInit
): Promise<Response> {
  const url = new URL(PAIRING_PATH, PAIRING_API_URLS[env]);
  return await fetchWithRetry(url, init);
}

async function fetchWithRetry(
  url: URL,
  init: RequestInit
): Promise<Response> {
  let lastError: Error | null = null;
  let lastErrorType: "network" | "server" | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.status >= 500 && response.status < 600) {
        lastErrorType = "server";
        lastError = new ServerError(
          `Server error: ${response.status}`
        );
        if (attempt < MAX_RETRIES) {
          console.log(
            `Server is temporarily unavailable, retrying... (attempt ${attempt} of ${MAX_RETRIES})`
          );
          await sleep(getBackoffDelay(attempt));
          continue;
        }
      }

      return response;
    } catch (error) {
      lastErrorType = "network";
      lastError =
        error instanceof Error
          ? new NetworkError(error.message)
          : new NetworkError("Unknown network error");

      if (attempt < MAX_RETRIES) {
        console.log(
          `Network connection issue, retrying... (attempt ${attempt} of ${MAX_RETRIES})`
        );
        await sleep(getBackoffDelay(attempt));
        continue;
      }
    }
  }

  if (lastErrorType === "network") {
    throw new NetworkError(
      "Unable to connect to Bee services. Please check your internet connection and try again."
    );
  }

  if (lastErrorType === "server") {
    throw new ServerError(
      "Bee servers are currently experiencing issues. Please try again later."
    );
  }

  throw lastError ?? new Error("Request failed after multiple retries.");
}

function getBackoffDelay(attempt: number): number {
  const delay = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
  return delay;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(
  response: Response
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await response.json()) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
