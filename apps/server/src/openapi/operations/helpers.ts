import { type ZodType, z } from "zod";

import { nonEmptyStringSchema } from "../../schemas/common.schema";
import {
  apiFailureSchema,
  apiSuccessSchema,
} from "../../schemas/response.schema";

export function operation(detail: Record<string, unknown>) {
  return { detail };
}

export function successEnvelope<T extends ZodType>(data: T) {
  return apiSuccessSchema.extend({ data }).strict();
}

export function okResponses<T extends ZodType>(
  data: T,
  extra: Record<number, unknown> = {},
) {
  return {
    200: jsonResponse(successEnvelope(data), "Successful ATLAS response."),
    400: validationResponse(),
    500: jsonResponse(apiFailureSchema, "Unexpected server error."),
    ...extra,
  };
}

export function validationResponse() {
  return jsonResponse(apiFailureSchema, "Request validation failed.");
}

export function notFoundResponse() {
  return jsonResponse(apiFailureSchema, "Requested resource was not found.");
}

export function forbiddenResponse() {
  return jsonResponse(
    apiFailureSchema,
    "Operation is not allowed for the current local server binding.",
  );
}

export function jsonRequest(bodySchema: ZodType, description: string) {
  return {
    description,
    required: true,
    content: {
      "application/json": {
        schema: schema(bodySchema),
      },
    },
  };
}

export function jsonResponse(bodySchema: ZodType, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: schema(bodySchema),
      },
    },
  };
}

export function pathParam(
  name: string,
  description: string,
  paramSchema: ZodType = nonEmptyStringSchema,
) {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: schema(paramSchema),
  };
}

export function queryParam(
  name: string,
  description: string,
  paramSchema: ZodType = nonEmptyStringSchema,
  required = false,
) {
  return {
    name,
    in: "query",
    required,
    description,
    schema: schema(paramSchema),
  };
}

export function schema(zodSchema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(zodSchema, {
    io: "input",
    target: "openapi-3.0",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
