import type { CompilerDiagnostic, CompilerStage } from "./types";

/** Creates a structured compiler diagnostic without optional undefined fields. */
export function compilerDiagnostic(input: {
  stage: CompilerStage;
  code: string;
  message: string;
  path?: string | undefined;
  docId?: string | undefined;
}): CompilerDiagnostic {
  return {
    stage: input.stage,
    code: input.code,
    message: input.message,
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.docId === undefined ? {} : { docId: input.docId })
  };
}
