import { GhesAuthenticationError } from "../errors";

/** GHES authentication configuration. Tokens are resolved before this package is called. */
export interface GhesAuthConfig {
  kind: "token";
  token: string;
}

/** Safe-to-log authentication metadata. */
export interface GhesAuthMetadata {
  kind: GhesAuthConfig["kind"];
}

/** Builds request-ready auth headers without exposing token values. */
export function buildAuthHeaders(auth: GhesAuthConfig): HeadersInit {
  const token = auth.token.trim();
  if (token.length === 0) {
    throw new GhesAuthenticationError({
      authMode: auth.kind,
      operation: "buildAuthHeaders",
      message: "GHES token must not be empty."
    });
  }

  return {
    authorization: `Bearer ${token}`
  };
}

export function describeAuth(auth: GhesAuthConfig): GhesAuthMetadata {
  return { kind: auth.kind };
}
