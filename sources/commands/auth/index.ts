import { select } from "@inquirer/prompts";
import type { Command, CommandContext } from "@/commands/types";
import { getEnvironmentConfig, type Environment } from "@/environment";
import { clearToken, loadToken, saveToken } from "@/secureStore";
import {
  decryptAppPairingToken,
  generateAppPairingKeyPair,
} from "@/utils/appPairingCrypto";
import { openBrowser } from "@/utils/browser";
import { renderQrCode } from "@/utils/qrCode";

type LoginOptions = {
  token?: string;
  tokenStdin: boolean;
};

type DevUser = {
  id: number;
  first_name: string;
  last_name: string | null;
};

type DeviceAuthMethod = "browser" | "qr";

type AppPairingRequest =
  | { status: "pending"; requestId: string; expiresAt: string }
  | { status: "completed"; requestId: string; encryptedToken: string }
  | { status: "expired"; requestId: string };

const USAGE = [
  "bee [--staging] auth login",
  "bee [--staging] auth login --token <token>",
  "bee [--staging] auth login --token-stdin",
  "bee [--staging] auth status",
  "bee [--staging] auth logout",
].join("\n");

const DESCRIPTION =
  "Manage developer API authentication (app tokens with embedded secrets).";

export const authCommand: Command = {
  name: "auth",
  description: DESCRIPTION,
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use login, status, or logout.");
    }

    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "login":
        await handleLogin(rest, context);
        return;
      case "status":
        await handleStatus(rest, context);
        return;
      case "logout":
        await handleLogout(rest, context);
        return;
      default:
        throw new Error(`Unknown auth subcommand: ${subcommand}`);
    }
  },
};

async function handleLogin(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseLoginArgs(args);

  if (options.tokenStdin && options.token) {
    throw new Error("Use either --token or --token-stdin, not both.");
  }

  let token = options.token;
  if (options.tokenStdin) {
    token = await readTokenFromStdin();
  }

  if (token) {
    token = token.trim();
  }

  if (!token) {
    token = await loginWithAppPairing(context);
  }

  if (!token) {
    throw new Error("Missing token.");
  }

  token = token.trim();

  const user = await fetchDeveloperMe(context, token);

  await saveToken(context.env, token);

  if (user) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    console.log(`Authenticated as ${name} (id ${user.id}).`);
    return;
  }

  console.log("Token stored.");
}

async function handleStatus(
  _args: readonly string[],
  context: CommandContext
): Promise<void> {
  if (_args.length > 0) {
    throw new Error("status does not accept arguments.");
  }
  const token = await loadToken(context.env);
  const config = getEnvironmentConfig(context.env);

  if (!token) {
    console.log("Not logged in.");
    console.log(`API: ${config.label} (${config.apiUrl})`);
    return;
  }

  console.log(`API: ${config.label} (${config.apiUrl})`);
  console.log(`Token: ${maskToken(token)}`);

  const user = await fetchDeveloperMe(context, token);
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  console.log(`Verified as ${name} (id ${user.id}).`);
}

async function handleLogout(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  if (args.length > 0) {
    throw new Error("logout does not accept arguments.");
  }
  await clearToken(context.env);
  console.log("Logged out.");
}

function parseLoginArgs(args: readonly string[]): LoginOptions {
  let token: string | undefined;
  let tokenStdin = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--token") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--token requires a value");
      }
      token = value;
      i += 1;
      continue;
    }

    if (arg === "--token-stdin") {
      tokenStdin = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 0) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  const options: LoginOptions = { tokenStdin };
  if (token !== undefined) {
    options.token = token;
  }
  return options;
}

async function readTokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("--token-stdin requires input via stdin.");
  }

  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");

  return await new Promise<string>((resolve, reject) => {
    process.stdin.on("data", (chunk) => {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      } else {
        chunks.push(chunk.toString("utf8"));
      }
    });
    process.stdin.on("error", (error) => {
      reject(error);
    });
    process.stdin.on("end", () => {
      resolve(chunks.join("").trim());
    });
  });
}

function maskToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 8) {
    return "********";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

async function loginWithAppPairing(context: CommandContext): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Interactive login requires a TTY. Use --token or --token-stdin."
    );
  }

  const appId = getDefaultAppId(context.env);
  const keyPair = generateAppPairingKeyPair();
  const publicKey = keyPair.publicKeyBase64;
  const secretKey = keyPair.secretKey;

  const { result: initial, baseUrl } = await requestAppPairing(
    context,
    appId,
    publicKey
  );

  if (initial.status === "completed") {
    return decryptAppPairingToken(initial.encryptedToken, secretKey);
  }

  if (initial.status === "expired") {
    throw new Error("Pairing request expired. Please try again.");
  }

  const pairingUrl = buildPairingUrl(initial.requestId);
  const method = await selectAuthMethod();

  await presentAppPairing(method, pairingUrl, initial.requestId);
  console.log("Waiting for authorization...");

  return await pollForAppToken(context, {
    appId,
    publicKey,
    secretKey,
    expiresAt: initial.expiresAt,
    baseUrl,
  });
}

async function selectAuthMethod(): Promise<DeviceAuthMethod> {
  return await select({
    message: "How would you like to authenticate?",
    choices: [
      { name: "Open a browser window", value: "browser" },
      { name: "Show a QR code", value: "qr" },
    ],
  });
}

async function presentAppPairing(
  method: DeviceAuthMethod,
  pairingUrl: string,
  requestId: string
): Promise<void> {
  console.log(`Pairing request: ${requestId}`);
  console.log(`Open this URL to approve the app: ${pairingUrl}`);

  if (method === "browser") {
    const opened = await openBrowser(pairingUrl);
    if (!opened) {
      console.log("Unable to open the browser automatically.");
    }
    return;
  }

  const qrCode = await renderQrCode(pairingUrl);
  console.log(qrCode);
}

async function requestAppPairing(
  context: CommandContext,
  appId: string,
  publicKey: string
): Promise<{ result: AppPairingRequest; baseUrl: string }> {
  const candidates = getPairingApiCandidates(context.env);
  let lastError: Error | null = null;

  for (const baseUrl of candidates) {
    try {
      const result = await requestAppPairingWithBase(
        context,
        appId,
        publicKey,
        baseUrl
      );
      return { result, baseUrl };
    } catch (error) {
      if (error instanceof PairingEndpointNotFoundError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("Pairing endpoint not found.");
}

async function requestAppPairingWithBase(
  context: CommandContext,
  appId: string,
  publicKey: string,
  baseUrl: string
): Promise<AppPairingRequest> {
  const response = await fetchPairing(context.env, baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_id: appId, publicKey }),
  });

  if (!response.ok) {
    const errorPayload = await safeJson(response);
    const errorCode =
      typeof errorPayload?.["error"] === "string" ? errorPayload["error"] : null;
    if (
      response.status === 404 &&
      (!errorCode || errorCode === "Not Found")
    ) {
      throw new PairingEndpointNotFoundError();
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

async function pollForAppToken(
  context: CommandContext,
  opts: {
    appId: string;
    publicKey: string;
    secretKey: Uint8Array;
    expiresAt: string;
    baseUrl: string;
  }
): Promise<string> {
  const expiresAtMs = Date.parse(opts.expiresAt);
  const deadline =
    Number.isNaN(expiresAtMs) || expiresAtMs <= 0
      ? Date.now() + 5 * 60 * 1000
      : expiresAtMs;
  const intervalMs = 2000;

  while (Date.now() < deadline) {
    const outcome = await requestAppPairingWithBase(
      context,
      opts.appId,
      opts.publicKey,
      opts.baseUrl
    );
    if (outcome.status === "completed") {
      return decryptAppPairingToken(
        outcome.encryptedToken,
        opts.secretKey
      );
    }
    if (outcome.status === "expired") {
      throw new Error("Pairing request expired. Please try again.");
    }
    await sleep(intervalMs);
  }

  throw new Error("Login timed out. Please try again.");
}

function buildPairingUrl(requestId: string): string {
  return `https://bee.computer.connect/${requestId}`;
}

function getPairingApiCandidates(env: Environment): string[] {
  const override = process.env["BEE_PAIRING_API_URL"]?.trim();
  if (override) {
    return [normalizeBaseUrl(override)];
  }

  const config = getEnvironmentConfig(env);
  const candidates = new Set<string>();
  const derived = derivePairingApiUrl(config.apiUrl);
  if (derived) {
    candidates.add(derived);
  }
  candidates.add(normalizeBaseUrl(config.apiUrl));
  return Array.from(candidates);
}

function derivePairingApiUrl(apiUrl: string): string | null {
  const trimmed = apiUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("app-api-developer.")) {
    return normalizeBaseUrl(trimmed.replace("app-api-developer.", "app-api."));
  }

  if (trimmed.includes("developer.")) {
    return normalizeBaseUrl(trimmed.replace("developer.", "api."));
  }

  if (trimmed.includes("-developer.")) {
    return normalizeBaseUrl(trimmed.replace("-developer.", "."));
  }

  return null;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

type PairingFetchInit = RequestInit & {
  tls?: { ca?: string | string[] };
};

async function fetchPairing(
  env: Environment,
  baseUrl: string,
  init: PairingFetchInit
): Promise<Response> {
  const config = getEnvironmentConfig(env);
  const url = new URL("/apps/pairing/request", baseUrl);
  return fetch(url, { ...init, tls: { ca: [...config.caCerts] } });
}

class PairingEndpointNotFoundError extends Error {
  constructor() {
    super("Pairing endpoint not found.");
  }
}

function getDefaultAppId(env: Environment): string {
  if (env === "staging") {
    return "pk5z3uuzjpxj4f7frk6rsq2f";
  }
  return "ph9fssu1kv1b0hns69fxf7rx";
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function fetchDeveloperMe(
  context: CommandContext,
  token: string
): Promise<DevUser> {
  const response = await context.client.fetch("/v1/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

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
    throw new Error("Invalid response from developer API.");
  }

  return {
    id,
    first_name: firstName,
    last_name: typeof data?.["last_name"] === "string" ? data["last_name"] : null,
  };
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
