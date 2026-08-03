import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { loadServerEnv } from "./env";
import { isLoopbackHost } from "./services/remote-security.service";
import {
  createDependencies,
  createServerTestFixture,
  type ServerTestFixture,
} from "./server.test-fixtures";

describe("server runtime", () => {
  let fixture: ServerTestFixture;
  let dbPath: string;
  let store: ServerTestFixture["store"];

  beforeEach(async () => {
    fixture = await createServerTestFixture();
    ({ dbPath, store } = fixture);
  });

  afterEach(async () => {
    await fixture.destroy();
  });

  test("validates server environment defaults and overrides", () => {
    expect(loadServerEnv({})).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      enableUi: false,
      enableMcp: true,
    });
    expect(
      loadServerEnv({
        ATLAS_HOST: "0.0.0.0",
        ATLAS_PORT: "40789",
        ATLAS_ENABLE_UI: "false",
      }),
    ).toMatchObject({
      host: "0.0.0.0",
      port: 40789,
      enableUi: false,
    });
    expect(() => loadServerEnv({ ATLAS_PORT: "99999" })).toThrow();
    expect(
      loadServerEnv({
        ATLAS_REMOTE_AUTH_TOKEN: "x".repeat(32),
        ATLAS_REMOTE_TLS_TERMINATED: "true",
        ATLAS_REMOTE_REPO_ALLOWLIST: "atlas, github.com/example/docs ",
      }).remote,
    ).toEqual({
      enabled: true,
      token: "x".repeat(32),
      tlsTerminated: true,
      repoAllowlist: ["atlas", "github.com/example/docs"],
      rateLimitPerMinute: 120,
      maxResponseBytes: 2 * 1024 * 1024,
    });
  });

  test("accepts only literal loopback listener hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.0.0.2")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("127.attacker.example")).toBe(false);
    expect(isLoopbackHost("0x7f000001")).toBe(false);
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(false);
  });

  test("serves health with opt-in telemetry enabled locally", async () => {
    const telemetryApp = createApp(
      createDependencies(store, dbPath, { enableTelemetry: true }),
    );

    const response = await telemetryApp.handle(
      new Request("http://atlas.local/health"),
    );

    expect(response.status).toBe(200);
  });
});
