import type { Metadata } from "next";
import "./grade.css";
import { OFFER } from "@/lib/grader/offer";

export const metadata: Metadata = {
  title: `Free Website Grade | ${OFFER.brand}`,
  description: "See how your website scores on speed, mobile, Google search and Google Maps, and the three fixes that would get you more calls.",
};

// Public grader pages (no login). Scoped styles live in grade.css under .gr.
export default function GradeLayout({ children }: { children: React.ReactNode }) {
  return <div className="gr">{children}</div>;
}
