import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { PasswordLogin } from "./password-login";

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await props.searchParams;

  async function requestLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return;
    await signIn("nodemailer", { email, redirect: false });
    redirect("/login/check-email");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Agency OS</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your email and we&apos;ll send you a sign-in link.
        </p>
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          That link didn&apos;t work — it may have expired or already been used. Request a new one.
        </p>
      ) : null}
      <form action={requestLink} className="flex flex-col gap-3">
        <input
          type="email"
          name="email"
          required
          autoFocus
          placeholder="you@agency.com"
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Send magic link
        </button>
      </form>
      <PasswordLogin />
    </main>
  );
}
