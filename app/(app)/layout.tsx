import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { QueryProvider } from "@/components/query-provider";
import { NotificationBell } from "@/components/notification-bell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { role, name, email } = session.user;
  const internal = role === "admin" || role === "member";

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <QueryProvider>
      <div className="mx-auto max-w-5xl p-4">
        <header className="mb-6 flex items-center justify-between gap-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className="font-semibold">
              Agency OS
            </Link>
            {internal && (
              <Link href="/tasks" className="text-muted hover:text-foreground">
                Tasks
              </Link>
            )}
            {internal && (
              <Link href="/leads" className="text-muted hover:text-foreground">
                Leads
              </Link>
            )}
            <Link href="/accounts" className="text-muted hover:text-foreground">
              Accounts
            </Link>
            {internal && (
              <Link href="/team" className="text-muted hover:text-foreground">
                Team
              </Link>
            )}
            {role === "admin" && (
              <Link href="/admin/health" className="text-muted hover:text-foreground">
                Health
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className="text-xs text-muted">{name || email}</span>
            <form action={doSignOut}>
              <button className="text-xs text-muted underline hover:text-foreground">
                Sign out
              </button>
            </form>
          </div>
        </header>
        {children}
      </div>
    </QueryProvider>
  );
}
