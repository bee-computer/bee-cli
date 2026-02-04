#!/usr/bin/env node
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platformMap = {
  darwin: "mac",
  linux: "linux",
};
const archMap = {
  arm64: "arm64",
  x64: "x64",
};

const resolvedPlatform = platformMap[process.platform];
const resolvedArch = archMap[process.arch];

if (!resolvedPlatform || !resolvedArch) {
  process.exit(0);
}

const binaryPath = path.resolve(
  __dirname,
  "..",
  "dist",
  "platforms",
  `${resolvedPlatform}-${resolvedArch}`,
  "bee"
);

if (!existsSync(binaryPath)) {
  process.exit(0);
}

try {
  chmodSync(binaryPath, 0o755);
} catch (error) {
  console.warn("Unable to set executable permissions for Bee CLI:", error);
}
