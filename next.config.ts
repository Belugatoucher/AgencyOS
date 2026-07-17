import type { NextConfig } from "next";

// Security headers per docs/98-security-audit.md item 10.
// CSP allows self + blob (upload previews) and connects to R2 for presigned PUTs.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // Next.js inline runtime; no external scripts
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob:",
      "connect-src 'self' https://*.r2.cloudflarestorage.com http://localhost:*",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
