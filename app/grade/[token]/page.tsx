import type { Metadata } from "next";
import { OFFER } from "@/lib/grader/offer";
import { OfferSection } from "../offer-section";
import { ReportClient } from "./report-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Website Report | ${OFFER.brand}`, robots: { index: false, follow: false } };

// Public report (token = capability; no contact details are ever sent to this page).
export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="gr-wrap">
      <header className="gr-top">
        <span className="gr-brand">{OFFER.brand}</span>
        <a className="gr-small gr-noprint" href="/grade">
          Grade another site
        </a>
      </header>
      <ReportClient token={token} />
      <div className="gr-noprint">
        <OfferSection context="report" />
      </div>
    </div>
  );
}
