/** Structured context attached to MCP adapter errors. */
export interface McpErrorContext {
  /** Operation that failed. */
  operation: string;
  /** Entity or subsystem involved in the failure. */
  entity?: string | undefined;
  /** Original thrown value, when available. */
  cause?: unknown;
}

/** Base class for ATLAS MCP adapter failures. */
export class AtlasMcpError extends Error {
  readonly context: McpErrorContext;

  constructor(message: string, context: McpErrorContext) {
    super(message);
    this.name = new.target.name;
    this.context = context;
    if (context.cause !== undefined) {
      this.cause = context.cause;
    }
  }
}

/** Raised when a tool receives invalid input after schema parsing. */
export class McpToolValidationError extends AtlasMcpError {}

/** Raised when required MCP package dependencies are missing or misconfigured. */
export class McpDependencyError extends AtlasMcpError {}

/** Raised when a requested MCP resource cannot be resolved. */
export class McpResourceNotFoundError extends AtlasMcpError {}

/** Raised when a transport cannot be created or attached. */
export class McpTransportError extends AtlasMcpError {}
