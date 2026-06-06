import type { CommandContext } from "@/commands/types";
import { BEE_MCP_TOOLS } from "@/mcp/toolDefinitions";
import { crc32, writeZip } from "@/mcp/zip";
import { assertShellSafe, beeConfigDir, beeLaunch, customBeeConfigDir, quoteShellArg, type BeeLaunch } from "@/mcp/launch";
import { VERSION } from "@/version";
import { deflateSync } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const SERVER_NAME = "bee";
const EXTENSION_FILE_NAME = "bee-claude.mcpb";

export async function connectClaudeDesktop(context: CommandContext): Promise<void> {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error("Claude Desktop extension install is available on macOS and Windows.");
  }
  const packagePath = await writeClaudeDesktopPackage(context);
  const openResult = openFile(packagePath);
  if (openResult.status !== 0) {
    const message = outputText(openResult.stderr).trim() || openResult.error?.message || "Unable to open Claude Desktop package.";
    throw new Error(message);
  }
  console.log("Opened the Bee connector package in Claude Desktop.");
  console.log("Click Install in Claude to finish connecting Bee.");
  console.log(`Package: ${packagePath}`);
}

export function connectClaudeCode(context: CommandContext): void {
  const launch = beeLaunch(context);
  ensureClaudeCode();
  const configDir = customBeeConfigDir();
  if (process.platform === "win32") {
    if (configDir !== null) {
      assertShellSafe(configDir, "BEE_CONFIG_DIR");
    }
    assertShellSafe(launch.command, "Bee CLI path");
    launch.args.forEach((arg) => assertShellSafe(arg, "Bee CLI argument"));
  }
  spawnClaude(["mcp", "remove", "--scope", "user", SERVER_NAME], false);
  const envArgs = configDir !== null ? ["--env", `BEE_CONFIG_DIR=${configDir}`] : [];
  const result = spawnClaude([
    "mcp",
    "add",
    "--scope",
    "user",
    ...envArgs,
    SERVER_NAME,
    "--",
    launch.command,
    ...launch.args,
  ], true);
  if (result.status !== 0) {
    throw new Error(outputText(result.stderr).trim() || result.error?.message || "Unable to register Bee with Claude Code.");
  }
  console.log("Bee MCP is connected to Claude Code.");
}

export async function disconnectClaudeDesktop(): Promise<void> {
  const packagePath = claudeDesktopPackagePath();
  if (!existsSync(packagePath)) {
    console.log(`No Bee connector package found at ${packagePath}.`);
    console.log("If Bee is still installed in Claude Desktop, remove it from Claude Desktop settings.");
    return;
  }
  await rm(packagePath, { force: true });
  console.log(`Removed the Bee connector package: ${packagePath}`);
  console.log("If Bee is still installed in Claude Desktop, remove it from Claude Desktop settings.");
}

export function disconnectClaudeCode(): void {
  ensureClaudeCode();
  const result = spawnClaude(["mcp", "remove", "--scope", "user", SERVER_NAME], true);
  if (result.status !== 0) {
    throw new Error(outputText(result.stderr).trim() || result.error?.message || "Unable to remove Bee from Claude Code.");
  }
  console.log("Bee MCP was removed from Claude Code.");
}

export function printMcpStatus(context: CommandContext): void {
  const launch = beeLaunch(context);
  console.log("Bee MCP status");
  console.log(`  Command: ${launch.command} ${launch.args.join(" ")}`.trimEnd());
  console.log(`  Environment: ${context.env}`);

  const version = spawnClaude(["--version"], false);
  if (version.error || version.status === null || version.status !== 0) {
    console.log("  Claude Code: not installed");
  } else {
    const claudeCode = spawnClaude(["mcp", "get", SERVER_NAME], false);
    if (claudeCode.status === 0) {
      console.log("  Claude Code: connected");
    } else {
      console.log("  Claude Code: not connected");
      console.log("    Run: bee mcp connect claude-code");
    }
  }

  const packagePath = claudeDesktopPackagePath();
  if (existsSync(packagePath)) {
    console.log(`  Claude Desktop: connector package generated (${packagePath})`);
    console.log("    Confirm Bee is installed in Claude Desktop settings, or run: bee mcp disconnect claude");
  } else {
    console.log("  Claude Desktop: no connector package generated");
    console.log("    Run: bee mcp connect claude");
  }
}

async function writeClaudeDesktopPackage(context: CommandContext): Promise<string> {
  const packagePath = claudeDesktopPackagePath();
  await mkdir(dirname(packagePath), { recursive: true, mode: 0o700 });
  const launch = beeLaunch(context);
  const zip = writeZip([
    {
      name: "manifest.json",
      data: Buffer.from(`${JSON.stringify(claudeManifest(), null, 2)}\n`, "utf8"),
    },
    {
      name: "server/index.js",
      data: Buffer.from(claudeServerScript(launch, customBeeConfigDir()), "utf8"),
    },
    {
      name: "icon.png",
      data: createBeeIconPng(),
    },
  ]);
  await writeFile(packagePath, zip, { mode: 0o600 });
  return packagePath;
}

function claudeManifest(): Record<string, unknown> {
  return {
    manifest_version: "0.3",
    name: SERVER_NAME,
    display_name: "Bee",
    version: VERSION,
    description: "Use Bee inside Claude for personal context from this computer.",
    long_description: [
      "Bee is an ambient AI wearable that lives alongside you and captures conversations plus other personal context.",
      "This connector launches the local Bee CLI on this computer. Bee CLI must be installed and signed in while Claude uses these tools.",
      "Conversation transcripts can contain ASR errors, so Claude should prefer Bee summaries, facts, daily summaries, and surrounding context over raw transcript text.",
    ].join("\n\n"),
    author: {
      name: "Bee",
      email: "support@bee.computer",
      url: "https://www.bee.computer",
    },
    homepage: "https://www.bee.computer",
    icon: "icon.png",
    server: {
      type: "node",
      entry_point: "server/index.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.js"],
      },
    },
    tools: BEE_MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
    tools_generated: false,
    keywords: ["bee", "ambient ai", "wearable", "conversations", "personal context", "mcp"],
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: ["darwin", "win32"],
      runtimes: {
        node: ">=16.0.0",
      },
    },
  };
}

function claudeServerScript(launch: BeeLaunch, configDir: string | null): string {
  const envLine = configDir !== null
    ? `const env = Object.assign({}, process.env, { BEE_CONFIG_DIR: ${JSON.stringify(configDir)} });`
    : "const env = process.env;";
  return `#!/usr/bin/env node
const { spawn } = require("child_process");

const command = ${JSON.stringify(launch.command)};
const args = ${JSON.stringify(launch.args)};
${envLine}

const child = spawn(command, args, {
  stdio: "inherit",
  windowsHide: true,
  env,
});

child.on("error", (error) => {
  process.stderr.write("Bee MCP failed to start: " + error.message + "\\n");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
`;
}

function claudeDesktopPackagePath(): string {
  return join(configDir(), "mcp", EXTENSION_FILE_NAME);
}

function configDir(): string {
  return beeConfigDir();
}

function ensureClaudeCode(): void {
  const result = spawnClaude(["--version"], false);
  if (result.status !== 0) {
    throw new Error("Claude Code was not found. Install Claude Code, then try again.");
  }
}

function spawnClaude(args: string[], inherit: boolean): ReturnType<typeof spawnSync> {
  const useShell = process.platform === "win32";
  return spawnSync("claude", useShell ? args.map(quoteShellArg) : args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    shell: useShell,
  });
}

function openFile(path: string): ReturnType<typeof spawnSync> {
  if (process.platform === "darwin") {
    return spawnSync("open", [path], { encoding: "utf8" });
  }
  return spawnSync("explorer.exe", [path], { encoding: "utf8" });
}

function outputText(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function createBeeIconPng(): Buffer {
  const width = 128;
  const height = 128;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const black = isInCircle(x, y, 47, 47, 16) ||
        isInCircle(x, y, 81, 47, 16) ||
        isInCircle(x, y, 47, 81, 16) ||
        isInCircle(x, y, 81, 81, 16) ||
        isInCircle(x, y, 64, 64, 11);
      raw[offset] = black ? 23 : 255;
      raw[offset + 1] = black ? 23 : 218;
      raw[offset + 2] = black ? 23 : 45;
      raw[offset + 3] = 255;
    }
  }

  const chunks = [
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function isInCircle(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radius: number
): boolean {
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}
