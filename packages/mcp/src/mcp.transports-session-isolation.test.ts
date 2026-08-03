import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import { createMcpTestFixture, type McpTestFixture } from "./mcp.test-fixtures";
import {
  createAtlasTransport,
  createStdioTransport,
  createStreamableHttpTransport,
} from "./server/transports";
describe("MCP transports and session isolation", () => {
  let fixture: McpTestFixture;

  beforeEach(async () => {
    fixture = await createMcpTestFixture();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  test("creates isolated stdio and streamable HTTP transports", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stdio = createStdioTransport(stdin, stdout);
    fixture.registerCleanup(async () => {
      await stdio.close();
      stdin.destroy();
      stdout.destroy();
    });
    expect(stdio).toBeDefined();

    const http = createStreamableHttpTransport();
    fixture.registerCleanup(() => http.close());
    expect(http).toBeDefined();

    const selected = createAtlasTransport({
      mode: "streamable-http",
      http: {},
    });
    fixture.registerCleanup(() => selected.close());
    expect(selected).toBeDefined();
  });
});
