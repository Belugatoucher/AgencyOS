// Week-1 Slack channel: a plain incoming webhook (the full Slack app is doc 15).
// Fire-and-forget with logging — a Slack outage must never fail a mutation.
export async function postToSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error(`[slack] webhook returned ${res.status}`);
  } catch (e) {
    console.error("[slack] webhook failed:", e);
  }
}
