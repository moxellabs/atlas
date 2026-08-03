import { runCli } from "./composition/lifecycle";

export type {
  AtlasProgramOptions,
  Runner,
  Runtime,
} from "./composition/contracts";
export { collectCommandPositionals } from "./composition/adapter";
export {
  createAtlasBaseCommand,
  createAtlasProgram,
  registerAtlasCommands,
} from "./composition/factory";
export { runCli, shouldStartFirstRunOnboarding } from "./composition/lifecycle";

if (import.meta.main) {
  process.exitCode = await runCli();
}
