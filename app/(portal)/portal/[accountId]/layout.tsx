import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { canViewAccount } from "@/lib/access";
import { currentViewer } from "@/lib/auth/session";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { QueryProvider } from "@/components/query-provider";

// Portal shell (docs/11): client-skinned — agency wordmark + account name,
// five tabs. Clients (members of the account) and internal previewers only;
// everything below renders through the existing client role checks.
export default async function PortalLayout(props: {
  children: React.ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { accountId } = await props.params;
  if (!canViewAccount(viewer, accountId)) notFound();
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account || account.deletedAt) notFound();

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const base = `/portal/${accountId}`;
  const tabs = [
    { href: base, label: "Home" },
    { href: `${base}/reviews`, label: "Reviews" },
    { href: `${base}/content`, label: "Content" },
    { href: `${base}/files`, label: "Files" },
    { href: `${base}/meetings`, label: "Meetings" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <QueryProvider>
      <div className="mx-auto max-w-4xl p-4">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Agency OS</p>
            <h1 className="text-lg font-semibold">{account.name}</h1>
          </div>
          <form action={doSignOut}>
            <button className="text-xs text-muted underline hover:text-foreground">Sign out</button>
          </form>
        </header>
        <nav className="mb-6 flex gap-4 border-b border-border pb-2 text-sm">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} className="text-muted hover:text-foreground">
              {t.label}
            </Link>
          ))}
        </nav>
        {props.children}
      </div>
    </QueryProvider>
  );
}
