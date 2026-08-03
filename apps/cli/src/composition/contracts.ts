import type {
  CliCommandContext,
  CliCommandResult,
  CliOutputOptions,
} from "../runtime/types";

export interface Runtime {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  env: NodeJS.ProcessEnv;
  cwdFallback: string;
  output: CliOutputOptions;
  exitCode?: number;
  mountDefaults?: Partial<Record<string, string>> | undefined;
  exposeIdentityOptions?: boolean;
}

export type Runner = (context: CliCommandContext) => Promise<CliCommandResult>;

export interface AtlasProgramOptions {
  readonly name?: string;
  readonly commandName?: string;
  readonly identityName?: string;
  readonly description?: string;
  readonly helpPrefix?: string;
  readonly helpQuickPath?: string;
  readonly exposeIdentityOptions?: boolean;
  readonly mountDefaults?: Partial<Record<string, string>> | undefined;
}

export interface OptionSpec {
  readonly flags: string;
  readonly description: string;
  readonly parser?: (value: string, previous: string[]) => string[];
}

export interface CommandDescriptor {
  readonly name: string;
  readonly description: string;
  readonly args: readonly string[];
  readonly runner: Runner;
  readonly options: readonly OptionSpec[];
  readonly usage?: string;
  readonly hidden?: boolean;
}

export interface CommandGroupDescriptor {
  readonly name: string;
  readonly description: string;
  readonly options: readonly OptionSpec[];
  readonly commands: readonly CommandDescriptor[];
  readonly runner?: Runner;
  readonly usage?: string;
  readonly allowExcessArguments?: boolean;
  readonly showHelpOnEmpty?: boolean;
  readonly visible?: (runtime: Runtime) => boolean;
}

export type CommandManifestEntry = CommandDescriptor | CommandGroupDescriptor;
