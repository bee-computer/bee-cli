import type { BeeCliRunner } from "./runner";

type LoginOptions = {
  token?: string;
  tokenStdin?: string;
  qr?: boolean;
  inheritStdio?: boolean;
};

export type AuthApi = {
  isAuthenticated: () => Promise<boolean>;
  getProfile: <T = unknown>() => Promise<T>;
  login: (options?: LoginOptions) => Promise<void>;
  logout: () => Promise<void>;
};

export function createAuthApi(runner: BeeCliRunner): AuthApi {
  async function getProfile<T = unknown>(): Promise<T> {
    return runner.runJson<T>(["me"]);
  }

  async function isAuthenticated(): Promise<boolean> {
    try {
      await getProfile();
      return true;
    } catch {
      return false;
    }
  }

  async function login(options: LoginOptions = {}): Promise<void> {
    if (options.token && options.tokenStdin) {
      throw new Error("Use either token or tokenStdin, not both.");
    }

    const args: string[] = ["login"];
    if (options.qr) {
      args.push("--qr");
    }

    let stdin: string | undefined;
    if (options.token) {
      args.push("--token", options.token);
    } else if (options.tokenStdin !== undefined) {
      args.push("--token-stdin");
      stdin = options.tokenStdin;
    }

    const inheritStdio =
      options.inheritStdio ??
      (options.token === undefined && options.tokenStdin === undefined);
    const runOptions = { inheritStdio } as { inheritStdio: boolean; stdin?: string };
    if (stdin !== undefined) {
      runOptions.stdin = stdin;
    }
    const result = await runner.run(args, runOptions);

    if (result.exitCode !== 0) {
      const message =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `Bee CLI login failed with code ${result.exitCode}.`;
      throw new Error(message);
    }
  }

  async function logout(): Promise<void> {
    const result = await runner.run(["logout"]);
    if (result.exitCode !== 0) {
      const message =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `Bee CLI logout failed with code ${result.exitCode}.`;
      throw new Error(message);
    }
  }

  return { isAuthenticated, getProfile, login, logout };
}
