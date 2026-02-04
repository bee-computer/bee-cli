#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platformMap = {
  darwin: "mac",
  linux: "linux",
  win32: "windows",
};
const archMap = {
  arm64: "arm64",
  x64: "x64",
};

const resolvedPlatform = platformMap[process.platform];
const resolvedArch = archMap[process.arch];

if (!resolvedPlatform || !resolvedArch) {
  console.error(
    `Unsupported platform for Bee CLI: ${process.platform} ${process.arch}`
  );
  process.exit(1);
}

const binaryName = resolvedPlatform === "windows" ? "bee.exe" : "bee";
const overridePath = process.env.BEE_CLI_BINARY;
const binaryPath = overridePath
  ? path.resolve(overridePath)
  : path.resolve(
      __dirname,
      "..",
      "dist",
      "platforms",
      `${resolvedPlatform}-${resolvedArch}`,
      binaryName
    );

if (!existsSync(binaryPath)) {
  console.error(
    `Bee CLI binary not found for ${resolvedPlatform}-${resolvedArch} at ${binaryPath}`
  );
  console.error("Reinstall the package or rebuild the platform binaries.");
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});

if (result.error) {
  console.error("Failed to launch Bee CLI binary:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
