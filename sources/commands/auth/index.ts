import { select } from "@inquirer/prompts";
import type { Command, CommandContext } from "@/commands/types";
import { getEnvironmentConfig, type Environment } from "@/environment";
import { clearToken, loadToken, saveToken } from "@/secureStore";
import { requestAppPairing } from "./appPairingRequest";
import {
  decryptAppPairingToken,
  generateAppPairingKeyPair,
} from "@/utils/appPairingCrypto";
import { emojiHash } from "@/utils/emojiHash";
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

const USAGE = [
  "bee auth login",
  "bee auth login --token <token>",
  "bee auth login --token-stdin",
  "bee auth status",
  "bee auth logout",
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
  const emoji = shouldShowEmojiHash()
    ? formatEmojiHash(keyPair.publicKeyBytes)
    : null;

  const initial = await requestAppPairing(context.env, appId, publicKey);

  if (initial.status === "completed") {
    return decryptAppPairingToken(initial.encryptedToken, secretKey);
  }

  if (initial.status === "expired") {
    throw new Error("Pairing request expired. Please try again.");
  }

  const pairingUrl = buildPairingUrl(initial.requestId);
  const method = await selectAuthMethod();

  await presentAppPairing(method, pairingUrl, initial.requestId, emoji);
  console.log("Waiting for authorization...");

  return await pollForAppToken({
    env: context.env,
    appId,
    publicKey,
    secretKey,
    expiresAt: initial.expiresAt,
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
  requestId: string,
  emojiHashValue: string | null
): Promise<void> {
  console.log(`Pairing request: ${requestId}`);
  console.log(`Open this URL to approve the app: ${pairingUrl}`);
  if (emojiHashValue) {
    console.log(`Emoji hash: ${emojiHashValue}`);
  }

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

function formatEmojiHash(publicKeyBytes: Uint8Array): string | null {
  const emojis = emojiHash(publicKeyBytes, 4);
  if (emojis.length === 0) {
    return null;
  }
  return emojis.join(" ");
}

function shouldShowEmojiHash(): boolean {
  const value = process.env["BEE_EMOJI_HASH"]?.trim().toLowerCase();
  if (!value) {
    return true;
  }
  return !["0", "false", "off", "no"].includes(value);
}

async function pollForAppToken(opts: {
  env: Environment;
  appId: string;
  publicKey: string;
  secretKey: Uint8Array;
  expiresAt: string;
}): Promise<string> {
  const expiresAtMs = Date.parse(opts.expiresAt);
  const deadline =
    Number.isNaN(expiresAtMs) || expiresAtMs <= 0
      ? Date.now() + 5 * 60 * 1000
      : expiresAtMs;
  const intervalMs = 2000;

  while (Date.now() < deadline) {
    const outcome = await requestAppPairing(
      opts.env,
      opts.appId,
      opts.publicKey
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
  return `https://bee.computer/connect/${requestId}`;
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
