"use client";

import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";

export function SettingsClient() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (password !== confirm) {
      setMsg("Passwords don't match");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/auth/password", { method: "POST", body: JSON.stringify({ password }) });
      setMsg("Password set ✅ — you can use it next time you sign in.");
      setPassword("");
      setConfirm("");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Sign-in password">
      <p className="mb-3 text-sm text-muted">
        Set a password to sign in directly (at least 10 characters). Magic links keep working either way.
      </p>
      <div className="flex max-w-sm flex-col gap-2">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          data-testid="set-password"
        />
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          data-testid="set-password-confirm"
        />
        <Button disabled={password.length < 10 || busy} onClick={save} className="self-start" data-testid="set-password-save">
          Save password
        </Button>
        {msg && <p className="text-sm text-muted">{msg}</p>}
      </div>
    </Card>
  );
}
