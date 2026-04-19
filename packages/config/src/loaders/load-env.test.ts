import { describe, expect, test } from "bun:test";

import { AtlasEnvValidationError, loadEnv } from "./load-env";

describe("loadEnv", () => {
  test("normalizes empty supported env vars to undefined", async () => {
    const env = await loadEnv({
      ATLAS_CONFIG: "",
      ATLAS_CACHE_DIR: "",
      ATLAS_LOG_LEVEL: "",
      ATLAS_CA_CERT_PATH: "",
      GHES_TOKEN: "",
      NODE_ENV: ""
    });

    expect(env).toEqual({});
  });

  test("returns typed supported env vars", async () => {
    const env = await loadEnv({
      ATLAS_CONFIG: "atlas.config.yaml",
      ATLAS_CACHE_DIR: ".cache",
      ATLAS_LOG_LEVEL: "info",
      ATLAS_CA_CERT_PATH: "certs/company.pem",
      GHES_TOKEN: "token",
      NODE_ENV: "test"
    });

    expect(env).toEqual({
      ATLAS_CONFIG: "atlas.config.yaml",
      ATLAS_CACHE_DIR: ".cache",
      ATLAS_LOG_LEVEL: "info",
      ATLAS_CA_CERT_PATH: "certs/company.pem",
      GHES_TOKEN: "token",
      NODE_ENV: "test"
    });
  });

  test("rejects invalid log levels", async () => {
    await expect(loadEnv({ ATLAS_LOG_LEVEL: "trace" })).rejects.toMatchObject({
      code: "ATLAS_ENV_VALIDATION_FAILED",
      issues: ["ATLAS_LOG_LEVEL: Invalid option: expected one of \"debug\"|\"info\"|\"warn\"|\"error\""]
    });
    await expect(loadEnv({ ATLAS_LOG_LEVEL: "trace" })).rejects.toThrow(AtlasEnvValidationError);
  });
});
