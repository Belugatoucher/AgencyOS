"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";

type User = { id: string; name: string; email: string; role: string; createdAt: string };

export function TeamClient({ canInviteInternal }: { canInviteInternal: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);

  const { data: team } = useQuery({
    queryKey: ["team"],
    queryFn: () => api<User[]>("/api/team"),
  });

  const invite = useMutation({
    mutationFn: () =>
      api<User>("/api/team", { method: "POST", body: JSON.stringify({ email, name, role }) }),
    onSuccess: () => {
      setEmail("");
      setName("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Team</h1>

      <Card title="Invite">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim() && name.trim()) invite.mutate();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            data-testid="team-invite-name"
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@agency.com"
            data-testid="team-invite-email"
          />
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Member</option>
            {canInviteInternal && <option value="admin">Admin</option>}
            <option value="client">Client</option>
          </Select>
          <Button type="submit" disabled={invite.isPending} data-testid="team-invite-submit">
            Invite
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <p className="mt-2 text-xs text-muted">
          Invitees sign in with a magic link at /login — no password setup needed.
        </p>
      </Card>

      <Card title="Everyone">
        {team?.length ? (
          <ul className="flex flex-col gap-1" data-testid="team-list">
            {team.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-background">
                <span>
                  {u.name || <span className="text-muted">(no name)</span>}{" "}
                  <span className="text-muted">· {u.email}</span>
                </span>
                <Badge>{u.role}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>
    </div>
  );
}
