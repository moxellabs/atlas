import type { CompilerStage } from "./types";

/** Context attached to all structured compiler errors. */
export interface CompilerErrorContext {
  /** Pipeline stage that failed. */
  stage: CompilerStage;
  /** Source path when known. */
  path?: string | undefined;
  /** Document identifier when known. */
  docId?: string | undefined;
  /** Source version when known. */
  sourceVersion?: string | undefined;
  /** Original error or thrown value. */
  cause?: unknown;
}

/** Base class for explicit compiler pipeline failures. */
export class CompilerError extends Error {
  /** Pipeline stage that failed. */
  readonly stage: CompilerStage;
  /** Source path when known. */
  readonly path?: string | undefined;
  /** Document identifier when known. */
  readonly docId?: string | undefined;
  /** Source version when known. */
  readonly sourceVersion?: string | undefined;
  /** Original error or thrown value. */
  override readonly cause?: unknown;

  constructor(message: string, context: CompilerErrorContext) {
    super(withContext(message, context), { cause: context.cause });
    this.name = new.target.name;
    this.stage = context.stage;
    this.path = context.path;
    this.docId = context.docId;
    this.sourceVersion = context.sourceVersion;
    this.cause = context.cause;
  }
}

/** Raised when markdown AST parsing fails. */
export class CompilerParseError extends CompilerError {
  constructor(message: string, context: Omit<CompilerErrorContext, "stage"> = {}) {
    super(message, { ...context, stage: "parse" });
  }
}

/** Raised when frontmatter markers are present but metadata cannot be parsed. */
export class CompilerFrontmatterError extends CompilerError {
  constructor(message: string, context: Omit<CompilerErrorContext, "stage"> = {}) {
    super(message, { ...context, stage: "frontmatter" });
  }
}

/** Raised when canonical document assembly receives inconsistent inputs. */
export class CanonicalDocumentBuildError extends CompilerError {
  constructor(message: string, context: Omit<CompilerErrorContext, "stage"> = {}) {
    super(message, { ...context, stage: "canonical" });
  }
}

/** Raised when skill extraction inputs do not describe the same skill document. */
export class SkillExtractionError extends CompilerError {
  constructor(message: string, context: Omit<CompilerErrorContext, "stage"> = {}) {
    super(message, { ...context, stage: "skill" });
  }
}

function withContext(message: string, context: CompilerErrorContext): string {
  const details = [
    `stage=${context.stage}`,
    context.path === undefined ? undefined : `path=${context.path}`,
    context.docId === undefined ? undefined : `docId=${context.docId}`,
    context.sourceVersion === undefined ? undefined : `sourceVersion=${context.sourceVersion}`
  ].filter((value): value is string => value !== undefined);
  return `${message} (${details.join(", ")})`;
}
