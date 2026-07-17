import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agency OS",
  description: "One internal platform to run the agency.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
