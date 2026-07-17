export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">Check your email</h1>
      <p className="text-sm text-muted">
        If that address belongs to an Agency OS user, a sign-in link is on its way. It expires
        in 10 minutes and works once.
      </p>
    </main>
  );
}
