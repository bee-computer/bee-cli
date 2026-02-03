import type { CommandContext } from "@/commands/types";
import {
  NetworkError,
  ServerError,
} from "@/commands/auth/appPairingRequest";

type ClientUser = {
  id: number;
  first_name: string;
  last_name: string | null;
};

const MAX_RETRIES = 10;
const MAX_BACKOFF_MS = 30000;

export async function fetchClientMe(
  context: CommandContext,
  token: string
): Promise<ClientUser> {
  const response = await fetchWithRetry(context, token);

  if (!response.ok) {
    const errorPayload = await safeJson(response);
    const message =
      typeof errorPayload?.["error"] === "string"
        ? errorPayload["error"]
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  const data = await safeJson(response);
  const id = data?.["id"];
  const firstName = data?.["first_name"];
  if (typeof id !== "number" || typeof firstName !== "string") {
    throw new Error("Invalid response from API.");
  }

  return {
    id,
    first_name: firstName,
    last_name: typeof data?.["last_name"] === "string" ? data["last_name"] : null,
  };
}

async function fetchWithRetry(
  context: CommandContext,
  token: string
): Promise<Response> {
  let lastError: Error | null = null;
  let lastErrorType: "network" | "server" | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await context.client.fetch("/v1/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status >= 500 && response.status < 600) {
        lastErrorType = "server";
        lastError = new ServerError(`Server error: ${response.status}`);
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
  return Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
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
