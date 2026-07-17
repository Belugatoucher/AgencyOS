// Typed Result returns from services (CLAUDE.md style rules).
export type ServiceError = {
  code: "forbidden" | "not_found" | "invalid" | "conflict" | "internal";
  message: string; // human, user-facing
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(code: ServiceError["code"], message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

export const statusForError: Record<ServiceError["code"], number> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  internal: 500,
};
