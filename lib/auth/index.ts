import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { authAdapter } from "./adapter";
import { sendMagicLinkEmail } from "./mailer";

export type Role = "admin" | "member" | "client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: authAdapter(),
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30-day session cookie (docs/00)
  },
  trustHost: true,
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
    error: "/login",
  },
  providers: [
    Nodemailer({
      // server config unused — sendVerificationRequest is fully custom.
      server: {},
      from: process.env.EMAIL_FROM ?? "Agency OS <no-reply@localhost>",
      maxAge: 10 * 60, // magic links expire in 10 minutes (audit item 3)
      async sendVerificationRequest({ identifier, url, request }) {
        const email = identifier.toLowerCase();

        // Rate limits per email + per IP; on breach or unknown user we drop
        // silently so the response is identical whether the email exists or
        // not — no enumeration, no mailbox-bombing (audit item 3).
        const ip =
          request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const [byEmail, byIp] = await Promise.all([
          rateLimit({ key: `magic:email:${email}`, limit: 3, windowSeconds: 15 * 60 }),
          rateLimit({ key: `magic:ip:${ip}`, limit: 10, windowSeconds: 15 * 60 }),
        ]);
        if (!byEmail.ok || !byIp.ok) {
          console.warn(`[auth] rate-limited magic-link request for ${email} from ${ip}`);
          return;
        }

        const [existing] = await db.select().from(users).where(eq(users.email, email));
        if (!existing) {
          console.warn(`[auth] magic-link requested for unknown email (dropped)`);
          return;
        }

        await sendMagicLinkEmail(email, url);
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      // Return a clean shape — the raw database session includes sessionToken,
      // which must never appear in the /api/auth/session response body.
      return {
        expires: session.expires,
        user: {
          id: user.id,
          email: user.email,
          name: user.name ?? "",
          role: ((user as { role?: string }).role ?? "client") as Role,
        },
      } as typeof session;
    },
  },
});
