import { NextResponse } from "next/server";
import { ZodError, type ZodType, type z } from "zod";
import type { Viewer } from "@/lib/access";
import { currentViewer } from "@/lib/auth/session";
import { statusForError, type Result } from "@/lib/result";
import { deepSanitize } from "@/lib/sanitize";

// Route handler shape (CLAUDE.md rule 2): parse (Zod) → auth → service → respond.
// withViewer handles auth + Result mapping so handlers stay one-liners.

type Handler<P> = (req: Request, viewer: Viewer, params: P) => Promise<Response>;

export function withViewer<P = Record<string, never>>(
  handler: Handler<P>,
): (req: Request, ctx: { params: Promise<P> }) => Promise<Response> {
  return async (req, ctx) => {
    const viewer = await currentViewer();
    if (!viewer) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    try {
      return await handler(req, viewer, await ctx.params);
    } catch (e) {
      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid request", issues: e.issues },
          { status: 400 },
        );
      }
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}:`, e);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export function respond<T>(result: Result<T>, okStatus = 200): Response {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.message },
      { status: statusForError[result.error.code] },
    );
  }
  return NextResponse.json(result.value, { status: okStatus });
}

// Body cap: JSON payloads have no legitimate reason to exceed this (large
// text fields like research pastes stay well under it; files go to R2).
const MAX_JSON_BYTES = 2 * 1024 * 1024;

/**
 * Parse + validate a JSON body. Every string in the payload passes through
 * deepSanitize (control/bidi/zero-width strip) BEFORE Zod — the global input
 * sanitization layer; Zod then enforces shape and size.
 */
export async function parseBody<S extends ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const raw = await req.text();
  if (raw.length > MAX_JSON_BYTES) {
    throw new ZodError([{ code: "custom", message: "Payload too large", path: [] }]);
  }
  return schema.parse(deepSanitize(JSON.parse(raw)));
}
