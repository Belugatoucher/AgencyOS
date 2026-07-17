import { PublicReviewClient } from "./public-review-client";

// Public review page — no session. All auth is the share token + optional PIN,
// resolved server-side by /api/share/[token] with rate-limited PIN attempts.
export default async function PublicReviewPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return (
    <main className="mx-auto max-w-5xl p-4">
      <PublicReviewClient token={token} />
    </main>
  );
}
