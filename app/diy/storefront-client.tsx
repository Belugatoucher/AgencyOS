"use client";

import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";

type CatalogCourse = { id: string; title: string; description: string | null; priceCents: number; buyable: boolean };

function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function Storefront() {
  const { data: catalog } = useQuery({ queryKey: ["diy-catalog"], queryFn: () => api<CatalogCourse[]>("/api/diy/catalog") });
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const cancelled = typeof window !== "undefined" && window.location.search.includes("cancelled=1");

  const buy = useMutation({
    mutationFn: (courseId: string) =>
      api<{ url: string }>("/api/diy/checkout", {
        method: "POST",
        body: JSON.stringify({ courseId, email: email.trim() || undefined }),
      }),
    onSuccess: (r) => {
      window.location.href = r.url; // off to Stripe Checkout
    },
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">DIY Courses</p>
        <h1 className="text-2xl font-semibold">Learn it yourself</h1>
        <p className="mt-1 text-sm text-muted">
          Pay once, get lifetime access. Your sign-in link arrives by email right after checkout.
        </p>
      </div>
      {cancelled && <p className="rounded-md border border-border bg-card p-3 text-sm text-muted">Checkout cancelled — no charge was made.</p>}
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com (optional — Stripe asks anyway)"
        data-testid="diy-email"
      />
      {catalog?.length ? (
        <ul className="flex flex-col gap-2" data-testid="diy-catalog">
          {catalog.map((c) => (
            <li key={c.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{c.title}</p>
                  {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-lg font-semibold">{money(c.priceCents)}</span>
                  <Button
                    disabled={!c.buyable || buy.isPending}
                    onClick={() => buy.mutate(c.id)}
                    data-testid={`diy-buy-${c.id}`}
                  >
                    {c.buyable ? "Buy" : "Coming soon"}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Card title="No courses on sale yet">
          <p className="text-sm text-muted">Check back soon.</p>
        </Card>
      )}
      {msg && <p className="text-sm text-warning">{msg}</p>}
      <p className="text-xs text-muted">
        Already bought a course? <a className="underline" href="/login">Sign in</a> — it's waiting in your library.
      </p>
    </div>
  );
}

export function StorefrontClient() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Storefront />
    </QueryClientProvider>
  );
}
