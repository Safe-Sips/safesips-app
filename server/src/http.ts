import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

/** Wrap an async handler so thrown/rejected errors reach Express' error chain. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Parse + validate a request body with zod; on failure send 400 and return null. */
export function parseBody<T>(
  schema: ZodType<T>,
  req: Request,
  res: Response
): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues[0]?.message ?? "Invalid request.",
      code: "invalid_body",
    });
    return null;
  }
  return result.data;
}

/** Parse + validate a query object with zod; on failure send 400 and return null. */
export function parseQuery<T>(
  schema: ZodType<T>,
  req: Request,
  res: Response
): T | null {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues[0]?.message ?? "Invalid query.",
      code: "invalid_query",
    });
    return null;
  }
  return result.data;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
