// The website + SEO offer the grader sells (docs/offers/web-seo.md). One place
// to edit names, prices and promises; the public /grade page and every report
// read from here. Pure data — safe to import anywhere.
//
// DECISION: prices are the starting test (see the playbook's validation plan).
// Change them here, not in the pages.

export type Package = {
  id: "launch" | "growth";
  name: string;
  setup: number; // USD, one time
  monthly: number; // USD per month
  pitch: string;
  includes: string[];
  highlight?: boolean;
};

export const OFFER: {
  brand: string;
  headline: string;
  bookingUrl: string | null;
  phone: string | null;
  guarantee: string;
  founding: { enabled: boolean; line: string };
  packages: Package[];
} = {
  brand: process.env.GRADER_BRAND_NAME ?? "VNGRD Media",
  headline: "Websites that get local businesses more calls",
  bookingUrl: process.env.GRADER_BOOKING_URL ?? null,
  phone: process.env.GRADER_PHONE ?? null,
  guarantee: "Live within 14 days of getting your content, or your setup fee comes back.",
  founding: {
    enabled: process.env.GRADER_FOUNDING_OFFER !== "off",
    line: "Founding client spots: half off setup for the first 5 businesses, in exchange for a case study.",
  },
  packages: [
    {
      id: "launch",
      name: "Launch",
      setup: 1500,
      monthly: 149,
      pitch: "A fast, custom site built to turn Google searches into calls.",
      includes: [
        "Custom 5–8 page site: services, the towns you serve, reviews, quote form",
        "Google Business Profile tune-up and local search setup (schema, titles, pages)",
        "Tap-to-call, quote form and missed-call text-back wired into your CRM",
        "Hosting, security, uptime monitoring and backups",
        "Small edits every month (up to 30 minutes)",
        "Monthly report: calls, form leads and where you show up on Google Maps",
      ],
    },
    {
      id: "growth",
      name: "Growth",
      setup: 2500,
      monthly: 299,
      highlight: true,
      pitch: "Everything in Launch, plus the work that moves you up Google Maps month after month.",
      includes: [
        "Everything in Launch",
        "2 new service or town pages every month",
        "Automatic review requests after every job",
        "Monthly Google Maps grid check against your top competitor",
        "Quarterly conversion test on your top page",
        "Priority edits (up to 2 hours a month)",
      ],
    },
  ],
};

export const money = (n: number) => `$${n.toLocaleString("en-US")}`;
