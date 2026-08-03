import { buildCliDependencies } from "../runtime/dependencies";
import type { CliCommandContext } from "../runtime/types";
/** Loads dependencies using already parsed global flags. */
export async function loadDependenciesFromGlobal(
  context: CliCommandContext,
  configPath?: string,
) {
  return buildCliDependencies({
    cwd: context.cwd,
    env: {
      ...context.env,
      ...(context.identityRoot === undefined
        ? {}
        : { ATLAS_IDENTITY_ROOT: context.identityRoot }),
    },
    ...(configPath === undefined ? {} : { configPath }),
  });
}
