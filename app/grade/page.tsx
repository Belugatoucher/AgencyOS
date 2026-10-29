import { OFFER } from "@/lib/grader/offer";
import { GradeForm } from "./grade-form";
import { OfferSection } from "./offer-section";

export const dynamic = "force-dynamic"; // env-driven brand, booking link and prices

const CHECKS = [
  { title: "Getting the call", body: "Is your phone number one tap away? Is there a quote form? Is the next step obvious?" },
  { title: "Google Maps", body: "Where you show up across your town for your main service, next to the competitor who's winning." },
  { title: "Search basics", body: "Titles, service and town pages, and the business details Google reads." },
  { title: "Speed", body: "Google's own phone speed test. Slow sites lose people before the page loads." },
  { title: "Mobile", body: "Most of your customers are on a phone. Does the site work there?" },
  { title: "Trust", body: "Reviews on the page, a secure connection, a current-looking site, no broken links." },
];

export default function GradePage() {
  return (
    <div className="gr-wrap">
      <header className="gr-top">
        <span className="gr-brand">{OFFER.brand}</span>
        <span className="gr-eyebrow">Free website grader</span>
      </header>

      <section className="gr-hero">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <span className="gr-eyebrow">For local service businesses</span>
          <h1>How many calls is your website losing?</h1>
          <p className="lede">
            Enter your site and get a graded report in about two minutes: speed, mobile, Google search, where you show up on Google Maps against your top
            competitor, and the fixes that would get you more calls, in the order to do them.
          </p>
          <p className="gr-small">Free. No sales call needed to see your results.</p>
        </div>
        <div className="gr-sheet">
          <GradeForm />
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-labelledby="checks-h">
        <h2 id="checks-h">What the report checks</h2>
        <div className="gr-checks">
          {CHECKS.map((c) => (
            <div key={c.title} className="gr-check">
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <OfferSection context="landing" />
    </div>
  );
}
