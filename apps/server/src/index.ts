import { startAtlasServer } from "./start-server";

const server = await startAtlasServer();

console.log(
  JSON.stringify({
    event: "startup",
    service: "ATLAS",
    host: server.host,
    port: server.port,
    dbPath: server.dbPath,
    repos: server.repoCount,
    uiEnabled: server.uiEnabled,
    mcpEnabled: server.mcpEnabled,
    openApiEnabled: server.openApiEnabled
  })
);
