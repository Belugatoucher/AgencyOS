// Input/output sanitization (hardening pass).
// Zod validates shape and size at every boundary; this layer handles the
// character-level problems Zod doesn't: control characters and Unicode
// direction-override tricks on the way IN, HTML escaping on the way OUT.

// C0 controls except \n(0A) and \t(09), DEL, C1 controls, bidi
// overrides/isolates (U+202A-202E, U+2066-2069) used to visually spoof
// strings, and zero-width characters (U+200B-200D, U+FEFF).
const STRIP_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g;

/** Strip control + spoofing characters from a string (keeps \n and \t). */
export function stripUnsafe(s: string): string {
  return s.replace(STRIP_RE, "");
}

/**
 * Recursively sanitize every string in a parsed JSON payload. Applied in
 * parseBody so EVERY route input passes through it before Zod — the global
 * input-sanitization layer.
 */
export function deepSanitize<T>(value: T): T {
  if (typeof value === "string") return stripUnsafe(value) as T;
  if (Array.isArray(value)) return value.map(deepSanitize) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[stripUnsafe(k)] = deepSanitize(v);
    }
    return out as T;
  }
  return value;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a string for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

// ts_headline highlight sentinels: the DB emits these instead of <b>/</b> so
// the untrusted text can be escaped FIRST; only then do the sentinels become
// real tags. Chosen to never survive escaping if an attacker types them —
// they contain no HTML-special chars, so a typed "@@hl@@" just renders bold,
// never markup.
export const HIGHLIGHT_START = "@@hl@@";
export const HIGHLIGHT_STOP = "@@/hl@@";

/**
 * Render a ts_headline snippet safely: escape everything, then convert the
 * sentinel markers to <b> tags. The only HTML that can survive is our own.
 */
export function safeHighlight(snippet: string): string {
  return escapeHtml(snippet)
    .replaceAll(HIGHLIGHT_STOP, "</b>")
    .replaceAll(HIGHLIGHT_START, "<b>");
}
