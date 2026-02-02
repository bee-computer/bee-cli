import type { Environment } from "@/environment";

const TOKEN_SERVICE = "bee-cli";

function tokenKey(env: Environment): { service: string; name: string } {
  return { service: TOKEN_SERVICE, name: `token:${env}` };
}

export async function loadToken(env: Environment): Promise<string | null> {
  const value = await Bun.secrets.get(tokenKey(env));
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function saveToken(env: Environment, token: string): Promise<void> {
  await Bun.secrets.set({ ...tokenKey(env), value: token });
}

export async function clearToken(env: Environment): Promise<void> {
  await Bun.secrets.delete(tokenKey(env));
}
