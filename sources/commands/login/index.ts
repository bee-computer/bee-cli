import type { Command, CommandContext } from "@/commands/types";
import { ValidationError } from "@/errors";
import type { Environment } from "@/environment";
import { createDeveloperClient, createProxyClient } from "@/client";
import {
  loadToken,
  saveToken,
  saveProxyConfig,
  loadProxyConfig,
  loadPairingState,
  savePairingState,
  clearPairingState,
  type PairingState,
} from "@/secureStore";
import { requestAppPairing } from "@/commands/auth/appPairingRequest";
import {
  decryptAppPairingToken,
  generateAppPairingKeyPair,
} from "@/utils/appPairingCrypto";
import { renderQrCode } from "@/utils/qrCode";
import { fetchClientMe } from "@/client/clientMe";
import { isSocketPath, normalizeProxyAddress } from "@/utils/proxyAddress";

type LoginOptions = {
  token?: string;
  proxy?: string;
  tokenStdin: boolean;
  qr: boolean;
  noWait: boolean;
};

const USAGE = [
  "bee login",
  "bee login --qr",
  "bee login --no-wait",
  "bee login --token <token>",
  "bee login --token-stdin",
  "bee login --proxy <url|socket>",
].join("\n");

export const loginCommand: Command = {
  name: "login",
  description: "Authenticate the CLI with your Bee account.",
  usage: USAGE,
  run: async (args, context) => {
    await handleLogin(args, context);
  },
};

async function handleLogin(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseLoginArgs(args);

  if (context.client.isProxy && !options.proxy && !options.token && !options.tokenStdin) {
    try {
      const user = await fetchClientMe(context);
      printExistingProxyMessage(user, context.client.proxyAddress ?? "configured proxy");
      return;
    } catch {
      throw new Error(
        "Proxy authentication is configured but not reachable. Run 'bee logout' to clear it first."
      );
    }
  }

  if (options.proxy) {
    const address = normalizeProxyAddress(options.proxy);
    const user = await validateProxyConnection(context.env, address);
    await saveProxyConfig(context.env, { address });
    printProxySuccessMessage(user, address);
    return;
  }

  const apiContext: CommandContext = {
    ...context,
    client: createDeveloperClient(context.env),
  };

  let token = options.token;
  if (options.tokenStdin) {
    token = await readTokenFromStdin();
  }

  if (token) {
    token = token.trim();
  }

  if (!token) {
    const existingProxy = await loadProxyConfig(context.env);
    if (existingProxy) {
      throw new Error(
        "Proxy authentication is configured. Run 'bee logout' first if you want to switch to token login."
      );
    }

    // Check if already authenticated
    const existingToken = await loadToken(context.env);
    if (existingToken) {
      try {
        const user = await fetchClientMe(apiContext, existingToken);
        const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
        console.log("");
        console.log(`You're already connected to Bee as ${name}.`);
        console.log("");
        console.log("If you need to switch to a different account, please run 'bee logout' first.");
        console.log("");
        console.log("Important: Only log out if you intentionally want to disconnect this device.");
        console.log("Re-authenticating will require access to the Bee app on your phone.");
        console.log("");
        return;
      } catch {
        // Token is invalid, proceed with login
      }
    }

    const paired = await loginWithAppPairing(apiContext, options.qr, options.noWait);
    if (paired === null) {
      // --no-wait: the link was printed and pairing state persisted; exit without
      // polling. The caller (e.g. an agent) sends the link to the user, then runs
      // `bee status` to check, or re-runs `bee login` to resume and finish.
      return;
    }
    token = paired;
  }

  if (!token) {
    throw new ValidationError("Missing token.");
  }

  token = token.trim();

  const user = await fetchClientMe(apiContext, token);

  await saveToken(context.env, token);

  printSuccessMessage(user);
}

function printSuccessMessage(user: {
  id: number;
  first_name: string;
  last_name: string | null;
}): void {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");

  console.log("");
  console.log(`Great news! I'm now connected to the Bee account of ${name}.`);
  console.log("");
  console.log("Everything is set up and I'm ready to help you!");
}

function printProxySuccessMessage(
  user: { first_name: string; last_name: string | null },
  address: string
): void {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  console.log("");
  console.log(`Connected to Bee via proxy (${address}) as ${name}.`);
  console.log("");
  console.log("Proxy authentication is now active for all commands.");
}

function printExistingProxyMessage(
  user: { first_name: string; last_name: string | null },
  address: string
): void {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  console.log("");
  console.log(`You're already connected to Bee via proxy (${address}) as ${name}.`);
  console.log("");
  console.log("Run 'bee logout' to clear proxy auth before switching login mode.");
}

export function parseLoginArgs(args: readonly string[]): LoginOptions {
  let token: string | undefined;
  let proxy: string | undefined;
  let tokenStdin = false;
  let qr = false;
  let noWait = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--token") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new ValidationError("--token requires a value");
      }
      token = value;
      i += 1;
      continue;
    }

    if (arg === "--token-stdin") {
      tokenStdin = true;
      continue;
    }

    if (arg === "--proxy") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new ValidationError("--proxy requires a value");
      }
      proxy = value;
      i += 1;
      continue;
    }

    if (arg === "--qr") {
      qr = true;
      continue;
    }

    if (arg === "--no-wait") {
      noWait = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new ValidationError(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 0) {
    throw new ValidationError(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  if (token && tokenStdin) {
    throw new Error("Use either --token or --token-stdin, not both.");
  }
  if (proxy && token) {
    throw new Error("Use either --proxy or --token, not both.");
  }
  if (proxy && tokenStdin) {
    throw new Error("Use either --proxy or --token-stdin, not both.");
  }
  // --no-wait only governs the interactive pairing flow; it is meaningless with a
  // token (already authenticated in one shot) or proxy auth.
  if (noWait && (token || tokenStdin)) {
    throw new Error("--no-wait cannot be used with --token or --token-stdin.");
  }
  if (noWait && proxy) {
    throw new Error("--no-wait cannot be used with --proxy.");
  }

  const options: LoginOptions = { tokenStdin, qr, noWait };
  if (token !== undefined) {
    options.token = token;
  }
  if (proxy !== undefined) {
    options.proxy = proxy;
  }
  return options;
}

export async function validateProxyConnection(
  env: Environment,
  address: string
): Promise<{
  id: number;
  first_name: string;
  last_name: string | null;
}> {
  const normalized = normalizeProxyAddress(address);
  if (!normalized) {
    throw new Error("Proxy address cannot be empty.");
  }

  if (!isSocketPath(normalized)) {
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new Error("Proxy URL must be a valid http:// or https:// URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Proxy URL must start with http:// or https://.");
    }
  }

  const proxyContext: CommandContext = {
    env,
    client: createProxyClient(env, { address: normalized }),
  };

  const response = await proxyContext.client.fetch("/v1/me", {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Proxy check failed with status ${response.status}.`;
    throw new Error(message);
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { id?: unknown }).id !== "number" ||
    typeof (payload as { first_name?: unknown }).first_name !== "string"
  ) {
    throw new Error("Proxy check failed: invalid /v1/me response.");
  }

  const userPayload = payload as {
    id: number;
    first_name: string;
    last_name?: unknown;
  };

  return {
    id: userPayload.id,
    first_name: userPayload.first_name,
    last_name: typeof userPayload.last_name === "string" ? userPayload.last_name : null,
  };
}

async function readTokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new ValidationError("--token-stdin requires input via stdin.");
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

// Runs the app-pairing flow. Returns the token on success. When noWait is true,
// prints the authentication link, persists the pairing state, and returns null
// WITHOUT polling — the caller exits so an agent can hand the link to the user
// and finish later with `bee login` (resumes) or check with `bee status`.
async function loginWithAppPairing(
  context: CommandContext,
  useQr: boolean,
  noWait: boolean
): Promise<string | null> {
  const existingState = await loadPairingState(context.env);

  if (existingState) {
    const expiresAtMs = Date.parse(existingState.expiresAt);
    const isExpired = !Number.isNaN(expiresAtMs) && Date.now() >= expiresAtMs;

    if (!isExpired) {
      await printWelcomeMessage(existingState.pairingUrl, existingState.expiresAt, "resumed", useQr, noWait);

      if (noWait) {
        return null;
      }

      const secretKey = Buffer.from(existingState.secretKey, "base64");
      try {
        const token = await pollForAppToken({
          env: context.env,
          appId: existingState.appId,
          publicKey: existingState.publicKey,
          secretKey: new Uint8Array(secretKey),
          expiresAt: existingState.expiresAt,
        });
        await clearPairingState(context.env);
        return token;
      } catch (error) {
        await clearPairingState(context.env);
        throw error;
      }
    }

    await clearPairingState(context.env);
  }

  const appId = getDefaultAppId(context.env);
  const keyPair = generateAppPairingKeyPair();
  const publicKey = keyPair.publicKeyBase64;
  const secretKey = keyPair.secretKey;

  const initial = await requestAppPairing(context.env, appId, publicKey);

  if (initial.status === "completed") {
    return decryptAppPairingToken(initial.encryptedToken, secretKey);
  }

  if (initial.status === "expired") {
    throw new Error("Pairing request expired. Please try again.");
  }

  const pairingUrl = buildPairingUrl(initial.requestId);

  const state: PairingState = {
    appId,
    publicKey,
    secretKey: Buffer.from(secretKey).toString("base64"),
    requestId: initial.requestId,
    pairingUrl,
    expiresAt: initial.expiresAt,
  };
  await savePairingState(context.env, state);

  const authStatus = existingState ? "reset" : "new";
  await printWelcomeMessage(pairingUrl, initial.expiresAt, authStatus, useQr, noWait);

  if (noWait) {
    return null;
  }

  try {
    const token = await pollForAppToken({
      env: context.env,
      appId,
      publicKey,
      secretKey,
      expiresAt: initial.expiresAt,
    });
    await clearPairingState(context.env);
    return token;
  } catch (error) {
    throw error;
  }
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
  return `https://bee.computer/connect#${requestId}`;
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

type AuthStatus = "new" | "resumed" | "reset";

async function printWelcomeMessage(
  pairingUrl: string,
  expiresAt: string,
  status: AuthStatus,
  useQr: boolean,
  noWait: boolean
): Promise<void> {
  const expiresAtMs = Date.parse(expiresAt);
  const remainingMs = expiresAtMs - Date.now();
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));

  console.log("Welcome to Bee AI!");
  console.log("");
  console.log("NOTE: To use the CLI, you must have the latest Bee app installed");
  console.log("and enable Developer Mode by tapping the app version 5 times in Settings.");
  console.log("");

  if (status === "resumed") {
    console.log("[Resuming previous authentication session]");
    console.log("");
  } else if (status === "reset") {
    console.log("[Previous authentication expired - starting a new session]");
    console.log("");
  } else {
    console.log("[Starting new authentication session]");
    console.log("");
  }

  console.log(
    "This is an authentication flow for Bee CLI to connect a Bee account to it."
  );
  console.log("");
  console.log(
    "To complete authentication, the device owner must authorize this connection."
  );
  console.log("There are two ways to do this:");
  console.log("");
  console.log("  1. Click on the authentication link below to open it in a browser");
  console.log(
    "  2. Or visit the link on any device and scan the QR code shown on the page"
  );
  console.log("");
  console.log(`Authentication link: ${pairingUrl}`);

  if (useQr) {
    console.log("");
    const qrCode = await renderQrCode(pairingUrl);
    console.log(qrCode);
  }

  console.log("");
  console.log(
    "Once the link is opened, follow the instructions to approve the connection."
  );
  console.log("");
  console.log(
    `This authentication request will expire in approximately ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`
  );
  console.log(
    "You can safely stop this process and restart it later to continue from where you left off,"
  );
  console.log("as long as the request has not expired.");
  console.log("");
  if (noWait) {
    console.log("Send the authentication link above to the device owner to approve.");
    console.log("Then run 'bee status' to confirm, or 'bee login' again to resume and finish.");
  } else {
    console.log("Now waiting for you to approve the connection using the link above...");
  }
}
