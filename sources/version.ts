import pkg from "../package.json" with { type: "json" };

type PackageJson = {
  name: string;
  version: string;
};

const { name, version } = pkg as PackageJson;

const envVersion = resolveEnvVersion();

export const PACKAGE_NAME = name;
export const VERSION = envVersion ?? version;

function resolveEnvVersion(): string | null {
  const env = process.env;
  const direct = env["BEE_VERSION"];
  if (direct && direct.trim().length > 0) {
    return sanitizeTag(direct);
  }

  if (env["GITHUB_REF_TYPE"] === "tag" && env["GITHUB_REF_NAME"]) {
    return sanitizeTag(env["GITHUB_REF_NAME"]);
  }

  if (env["GITHUB_REF"]) {
    const match = env["GITHUB_REF"].match(/refs\/tags\/(.+)$/);
    if (match && match[1]) {
      return sanitizeTag(match[1]);
    }
  }

  if (env["GITHUB_REF_NAME"] && env["GITHUB_REF_NAME"].startsWith("v")) {
    return sanitizeTag(env["GITHUB_REF_NAME"]);
  }

  return null;
}

function sanitizeTag(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.startsWith("v") && trimmed.length > 1) {
    return trimmed.slice(1);
  }
  return trimmed;
}
