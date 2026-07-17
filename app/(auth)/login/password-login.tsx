"use client";

import { useState } from "react";

// Password sign-in (portal clients; anyone who has set a password). Magic
// links remain the default path — this is the "I have a password" alternative.
export function PasswordLogin() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/password-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      window.location.href = "/";
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Sign-in failed");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-muted underline hover:text-foreground"
        data-testid="pw-login-toggle"
      >
        Sign in with a password instead
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-4">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        placeholder="you@company.com"
        data-testid="pw-email"
        className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        placeholder="Password"
        data-testid="pw-password"
        className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        data-testid="pw-submit"
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        Sign in
      </button>
      <p className="text-xs text-muted">No password yet? Use a magic link once, then set one in your portal.</p>
    </form>
  );
}
