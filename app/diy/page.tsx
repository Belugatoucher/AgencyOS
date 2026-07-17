import { StorefrontClient } from "./storefront-client";

// Public DIY storefront (db/009): no login — browse paid courses, buy via
// Stripe Checkout. Access arrives by email after payment.
export default function DiyPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <StorefrontClient />
    </div>
  );
}
