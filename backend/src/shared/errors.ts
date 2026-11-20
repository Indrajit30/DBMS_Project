import type { ErrorRequestHandler, Request } from "express";
import type { ApiErrorCode } from "./types.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function requestId(request: Request): string {
  return request.requestId ?? "unknown";
}

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        request_id: requestId(request),
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Malformed JSON request body",
        request_id: requestId(request),
      },
    });
    return;
  }

  console.error("Unhandled request error", {
    requestId: requestId(request),
    message: error instanceof Error ? error.message : String(error),
  });
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      request_id: requestId(request),
    },
  });
};
