import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted">That page doesn&apos;t exist or you can&apos;t see it.</p>
      <Link href="/" className="text-sm text-accent underline">
        Back home
      </Link>
    </main>
  );
}
