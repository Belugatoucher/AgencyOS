import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  const smtpUrl = process.env.SMTP_URL;

  // DECISION: dev mailbox — without SMTP_URL the link is written to
  // .dev-mail/last-link.txt (gitignored) and logged. Local dev and the
  // Playwright smoke test read it from there; production requires SMTP_URL.
  if (!smtpUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP_URL is required in production");
    }
    const dir = path.join(process.cwd(), ".dev-mail");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "last-link.txt"), `${to}\n${url}\n`);
    console.log(`[dev-mail] magic link for ${to}: ${url}`);
    return;
  }

  const transport = nodemailer.createTransport(smtpUrl);
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "Agency OS <no-reply@localhost>",
    to,
    subject: "Sign in to Agency OS",
    text: `Sign in to Agency OS:\n\n${url}\n\nThis link expires in 10 minutes and can be used once. If you didn't request it, ignore this email.`,
    html: [
      `<p>Sign in to Agency OS:</p>`,
      `<p><a href="${url}">Click here to sign in</a></p>`,
      `<p style="color:#666">This link expires in 10 minutes and can be used once. If you didn't request it, ignore this email.</p>`,
    ].join("\n"),
  });
}
