import { PROD_ROOT_CA, STAGING_CA_CERT } from "@/certs";

export type Environment = "prod" | "staging";

type EnvironmentConfig = {
  label: string;
  apiUrl: string;
  caCerts: readonly string[];
};

const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  prod: {
    label: "production",
    apiUrl: "https://app-api-developer.ce.bee.amazon.dev/",
    caCerts: [PROD_ROOT_CA],
  },
  staging: {
    label: "staging",
    apiUrl: "https://developer.ce.korshaks.people.amazon.dev/",
    caCerts: [STAGING_CA_CERT],
  },
};

export function getEnvironmentConfig(env: Environment): EnvironmentConfig {
  return ENVIRONMENTS[env];
}
