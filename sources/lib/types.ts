export type BeeEnvironment = "prod" | "staging";

export type BeeCliOptions = {
  command?: string;
  baseArgs?: string[];
  environment?: BeeEnvironment;
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type RunOptions = {
  stdin?: string;
  inheritStdio?: boolean;
  signal?: AbortSignal;
};

export type SpawnOptions = {
  stdout?: "pipe" | "inherit" | "ignore";
  stderr?: "pipe" | "inherit" | "ignore";
  stdin?: "pipe" | "inherit" | "ignore";
  signal?: AbortSignal;
};
