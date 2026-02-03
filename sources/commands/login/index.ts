import type { Command, CommandContext } from "@/commands/types";
import type { Environment } from "@/environment";
import {
  loadToken,
  saveToken,
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

type LoginOptions = {
  token?: string;
  tokenStdin: boolean;
  qr: boolean;
};

const USAGE = [
  "bee login",
  "bee login --qr",
  "bee login --token <token>",
  "bee login --token-stdin",
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
    // Check if already authenticated
    const existingToken = await loadToken(context.env);
    if (existingToken) {
      try {
        const user = await fetchClientMe(context, existingToken);
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

    token = await loginWithAppPairing(context, options.qr);
  }

  if (!token) {
    throw new Error("Missing token.");
  }

  token = token.trim();

  const user = await fetchClientMe(context, token);

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

function parseLoginArgs(args: readonly string[]): LoginOptions {
  let token: string | undefined;
  let tokenStdin = false;
  let qr = false;
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

    if (arg === "--qr") {
      qr = true;
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

  const options: LoginOptions = { tokenStdin, qr };
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

async function loginWithAppPairing(
  context: CommandContext,
  useQr: boolean
): Promise<string> {
  const existingState = await loadPairingState(context.env);

  if (existingState) {
    const expiresAtMs = Date.parse(existingState.expiresAt);
    const isExpired = !Number.isNaN(expiresAtMs) && Date.now() >= expiresAtMs;

    if (!isExpired) {
      printWelcomeMessage(existingState.pairingUrl, existingState.expiresAt, "resumed", useQr);

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
  printWelcomeMessage(pairingUrl, initial.expiresAt, authStatus, useQr);

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

type AuthStatus = "new" | "resumed" | "reset";

async function printWelcomeMessage(
  pairingUrl: string,
  expiresAt: string,
  status: AuthStatus,
  useQr: boolean
): Promise<void> {
  const expiresAtMs = Date.parse(expiresAt);
  const remainingMs = expiresAtMs - Date.now();
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));

  console.log("Welcome to Bee AI!");
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
  console.log("Now waiting for you to approve the connection using the link above...");
}
