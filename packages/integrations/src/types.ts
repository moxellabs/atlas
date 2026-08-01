export const AGENT_CLIENT_IDS = [
  "codex",
  "claude",
  "gemini",
  "antigravity",
  "copilot",
  "opencode",
  "aider",
  "vscode",
  "cursor",
  "windsurf",
  "cline",
  "roo-code",
  "continue",
  "zed",
  "jetbrains",
  "junie",
  "kiro",
  "amazon-q",
] as const;

export type AgentClientId = (typeof AGENT_CLIENT_IDS)[number];
export type AgentClientKind = "headless" | "ide";
export type AgentIntegrationScope = "user" | "workspace";
export type AgentIntegrationMode = "standard" | "discoverable" | "prefer-local";

export interface ServerLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export interface NativeAdapter {
  readonly kind: "native";
  readonly executable: string;
  readonly add: (
    server: ServerLaunchSpec,
    scope: AgentIntegrationScope,
  ) => readonly string[];
  readonly remove: (scope: AgentIntegrationScope) => readonly string[];
  readonly check: (scope: AgentIntegrationScope) => readonly string[];
  readonly checkOutputIncludes: (server: ServerLaunchSpec) => readonly string[];
  readonly verification: {
    readonly relativePath: string;
    readonly rootPath: readonly string[];
  };
}

export interface CodexAdapter {
  readonly kind: "codex";
  readonly relativePath: string;
}

export interface JsonAdapter {
  readonly kind: "json";
  readonly relativePath: string | ((platform: NodeJS.Platform) => string);
  readonly rootPath: readonly string[];
  readonly serverValue: (server: ServerLaunchSpec) => unknown;
}

export interface ManagedFileAdapter {
  readonly kind: "managed-file";
  readonly relativePath: string;
  readonly render: (server: ServerLaunchSpec) => string;
}

export interface ManualAdapter {
  readonly kind: "manual";
  readonly reason: string;
  readonly render: (server: ServerLaunchSpec) => unknown;
}

export type AgentClientAdapter =
  | NativeAdapter
  | CodexAdapter
  | JsonAdapter
  | ManagedFileAdapter
  | ManualAdapter;

export interface AgentIntegrationDescriptor {
  readonly id: AgentClientId;
  readonly displayName: string;
  readonly kind: AgentClientKind;
  readonly executable?: string | undefined;
  readonly minimumVersion?: string | undefined;
  readonly user?: AgentClientAdapter | undefined;
  readonly workspace?: AgentClientAdapter | undefined;
  readonly notes?: readonly string[] | undefined;
}

export interface AgentDetectionResult {
  readonly clientId: AgentClientId;
  readonly displayName: string;
  readonly installed: boolean;
  readonly executablePath?: string | undefined;
  readonly version?: string | undefined;
  readonly versionSupported?: boolean | undefined;
  readonly versionProbeError?: string | undefined;
  readonly configuredScopes: readonly AgentIntegrationScope[];
}

export interface CommandOperation {
  readonly kind: "command";
  readonly command: readonly string[];
  readonly inverse: readonly string[];
  readonly check: readonly string[];
  readonly checkOutputIncludes: readonly string[];
  readonly verification: NativeConfigVerification;
}

export interface NativeConfigVerification {
  readonly kind: "native-config";
  readonly path: string;
  readonly keyPath: readonly string[];
  readonly server: ServerLaunchSpec;
}

export interface JsonMergeOperation {
  readonly kind: "json-merge";
  readonly path: string;
  readonly keyPath: readonly string[];
  readonly value: unknown;
}

export interface CodexConfigOperation {
  readonly kind: "codex-config";
  readonly path: string;
  readonly serverName: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly discoverable: boolean;
}

export interface ManagedFileOperation {
  readonly kind: "managed-file";
  readonly path: string;
  readonly content: string;
}

export interface ManualOperation {
  readonly kind: "manual";
  readonly reason: string;
  readonly config: unknown;
}

export type IntegrationOperation =
  | CommandOperation
  | JsonMergeOperation
  | CodexConfigOperation
  | ManagedFileOperation
  | ManualOperation;

export interface AgentIntegrationPlan {
  readonly action: "install" | "remove";
  readonly clientId: AgentClientId;
  readonly displayName: string;
  readonly scope: AgentIntegrationScope;
  readonly mode: AgentIntegrationMode;
  readonly server: ServerLaunchSpec;
  readonly operations: readonly IntegrationOperation[];
  readonly receiptPath: string;
  readonly fingerprint: string;
  readonly requiresManualAction: boolean;
  readonly notes: readonly string[];
}

export interface AgentIntegrationReceipt {
  readonly schemaVersion: 1;
  readonly clientId: AgentClientId;
  readonly scope: AgentIntegrationScope;
  readonly mode: AgentIntegrationMode;
  readonly installedAt: string;
  readonly fingerprint: string;
  readonly server: ServerLaunchSpec;
  readonly operations: readonly IntegrationOperation[];
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type IntegrationCommandRunner = (
  command: readonly string[],
  options?: {
    readonly cwd?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly timeoutMs?: number | undefined;
  },
) => Promise<CommandResult>;

export interface IntegrationEnvironment {
  readonly homeDir: string;
  readonly workspaceDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly path?: string | undefined;
  readonly platform: NodeJS.Platform;
  readonly now?: (() => Date) | undefined;
  readonly runCommand?: IntegrationCommandRunner | undefined;
}

export interface PlanIntegrationInput {
  readonly clientId: AgentClientId;
  readonly scope: AgentIntegrationScope;
  readonly mode: AgentIntegrationMode;
  readonly server?: ServerLaunchSpec | undefined;
}

export interface ApplyIntegrationResult {
  readonly changed: boolean;
  readonly plan: AgentIntegrationPlan;
  readonly receipt?: AgentIntegrationReceipt | undefined;
}

export interface AgentDoctorResult {
  readonly detection: AgentDetectionResult;
  readonly scope: AgentIntegrationScope;
  readonly healthy: boolean;
  readonly receiptPresent: boolean;
  readonly issues: readonly string[];
  readonly nextActions: readonly string[];
}
