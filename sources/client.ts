import { getEnvironmentConfig, type Environment } from "@/environment";

type TlsOptions = {
  ca?: string | string[];
};

type FetchInit = RequestInit & {
  tls?: TlsOptions;
};

export type DeveloperClient = {
  env: Environment;
  baseUrl: string;
  fetch: (path: string, init?: FetchInit) => Promise<Response>;
};

export function createDeveloperClient(env: Environment): DeveloperClient {
  const config = getEnvironmentConfig(env);
  const ca = [...config.caCerts];

  return {
    env,
    baseUrl: config.apiUrl,
    fetch: (path, init) => {
      const url = new URL(path, config.apiUrl);
      const requestInit: FetchInit = init
        ? { ...init, tls: { ca } }
        : { tls: { ca } };
      return fetch(url, requestInit);
    },
  };
}
