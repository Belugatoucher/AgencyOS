import { IntakeFormClient } from "./intake-form-client";

// Public client intake (docs/10): token link, no login. The client component
// fetches the form via the hardened public API and saves partially.
export default async function OnboardPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return (
    <div className="mx-auto max-w-2xl p-6">
      <IntakeFormClient token={token} />
    </div>
  );
}
