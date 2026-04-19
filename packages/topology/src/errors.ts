/** Base class for intentionally categorized topology failures. */
export class TopologyError extends Error {
  constructor(
    readonly code:
      | "TOPOLOGY_UNSUPPORTED_ADAPTER"
      | "TOPOLOGY_INCONSISTENT_PACKAGE_STATE"
      | "TOPOLOGY_INCONSISTENT_MODULE_STATE"
      | "TOPOLOGY_IMPOSSIBLE_OWNERSHIP"
      | "TOPOLOGY_ID_COLLISION",
    message: string,
    readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Raised when no topology adapter supports the provided repo context. */
export class UnsupportedTopologyAdapterError extends TopologyError {
  constructor(context: Record<string, unknown> = {}) {
    super("TOPOLOGY_UNSUPPORTED_ADAPTER", "No topology adapter supports this repository context.", context);
  }
}

/** Raised when package discovery produces contradictory package state. */
export class InconsistentPackageDiscoveryError extends TopologyError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("TOPOLOGY_INCONSISTENT_PACKAGE_STATE", message, context);
  }
}

/** Raised when module discovery produces contradictory module state. */
export class InconsistentModuleDiscoveryError extends TopologyError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("TOPOLOGY_INCONSISTENT_MODULE_STATE", message, context);
  }
}

/** Raised when explicit ownership cannot be resolved in an internally valid way. */
export class ImpossibleOwnershipResolutionError extends TopologyError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("TOPOLOGY_IMPOSSIBLE_OWNERSHIP", message, context);
  }
}

/** Raised when deterministic ID construction collides for distinct entities. */
export class TopologyIdCollisionError extends TopologyError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("TOPOLOGY_ID_COLLISION", message, context);
  }
}
