import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

export async function sendInviteEmail(to: string, name: string): Promise<void> {
  const loginUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/login`;
  const smtpUrl = process.env.SMTP_URL;

  if (!smtpUrl) {
    // Same dev-mailbox convention as magic links; invites must not crash
    // local dev that has no SMTP.
    const dir = path.join(process.cwd(), ".dev-mail");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "last-invite.txt"), `${to}\n${loginUrl}\n`);
    console.log(`[dev-mail] invite for ${to}: ${loginUrl}`);
    return;
  }

  const transport = nodemailer.createTransport(smtpUrl);
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "Agency OS <no-reply@localhost>",
    to,
    subject: "You've been invited to Agency OS",
    text: `Hi ${name},\n\nYou've been invited to Agency OS. Sign in with this email address here:\n\n${loginUrl}\n\nNo password needed — we'll email you a sign-in link.`,
  });
}
