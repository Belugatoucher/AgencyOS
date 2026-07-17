"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { UploadCard } from "./upload-card";

type Project = { id: string; name: string; status: string };
type Member = { userId: string; role: string; name: string; email: string };

export function AccountDetailClient({
  account,
  internal,
}: {
  account: { id: string; name: string; timezone: string };
  internal: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{account.name}</h1>
        <p className="text-sm text-muted">{account.timezone}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ProjectsCard accountId={account.id} internal={internal} />
        <MembersCard accountId={account.id} internal={internal} />
      </div>
      <UploadCard accountId={account.id} internal={internal} />
    </div>
  );
}

function ProjectsCard({ accountId, internal }: { accountId: string; internal: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const key = ["projects", accountId];

  const { data: projects } = useQuery({
    queryKey: key,
    queryFn: () => api<Project[]>(`/api/accounts/${accountId}/projects`),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Project>(`/api/accounts/${accountId}/projects`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <Card title="Projects">
      {internal && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New project"
            className="flex-1"
          />
          <Button type="submit" disabled={create.isPending}>
            Add
          </Button>
        </form>
      )}
      {projects?.length ? (
        <ul className="flex flex-col gap-1">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-background">
              <span>{p.name}</span>
              <Badge>{p.status}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No projects yet.</p>
      )}
    </Card>
  );
}

function MembersCard({ accountId, internal }: { accountId: string; internal: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"client" | "member">("client");
  const [error, setError] = useState<string | null>(null);
  const key = ["members", accountId];

  const { data: members } = useQuery({
    queryKey: key,
    queryFn: () => api<Member[]>(`/api/accounts/${accountId}/members`),
  });

  const add = useMutation({
    mutationFn: () =>
      api<Member>(`/api/accounts/${accountId}/members`, {
        method: "POST",
        body: JSON.stringify({ email, name, role }),
      }),
    onSuccess: () => {
      setEmail("");
      setName("");
      setError(null);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/accounts/${accountId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <Card title="People">
      {internal && (
        <form
          className="mb-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim() && name.trim()) add.mutate();
          }}
        >
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="flex-1"
              data-testid="invite-name"
            />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@client.com"
              className="flex-1"
              data-testid="invite-email"
            />
          </div>
          <div className="flex gap-2">
            <Select value={role} onChange={(e) => setRole(e.target.value as "client" | "member")}>
              <option value="client">Client contact</option>
              <option value="member">Team member</option>
            </Select>
            <Button type="submit" disabled={add.isPending} data-testid="invite-submit">
              Invite
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      )}
      {members?.length ? (
        <ul className="flex flex-col gap-1" data-testid="members-list">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-background">
              <span>
                {m.name} <span className="text-muted">· {m.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge>{m.role}</Badge>
                {internal && (
                  <button
                    aria-label={`Remove ${m.name}`}
                    onClick={() => remove.mutate(m.userId)}
                    className="text-xs text-muted hover:text-destructive"
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nobody here yet.</p>
      )}
    </Card>
  );
}
