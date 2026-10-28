import type { DeployRequest, DeployState, HostProvider, RepoProvider } from "@/lib/sites/types";

// Hosting + repo providers (docs/18).
//
// manual host — Agency OS records deploys but doesn't perform them: a preview
//   is "ready" at the URL the build reported; promoting to production records
//   the site's production URL. Fine for the first sites (the agent / a person
//   deploys with `wrangler pages deploy` or the Vercel CLI).
//
// cloudflare_pages / vercel — interface placeholders. They report themselves
//   unavailable so the registry falls back loudly instead of half-working.
//   Implementation notes are inline for the next session.

export const manualHost: HostProvider = {
  id: "manual",
  label: "Manual (record deploys done elsewhere)",
  async ensureProject(site) {
    return { hostRef: site.hostRef };
  },
  async deploy(req: DeployRequest): Promise<DeployState> {
    if (req.environment === "production") {
      const url = req.site.domain ? `https://${req.site.domain}` : req.knownUrl;
      return { status: "ready", providerRef: null, url };
    }
    return req.knownUrl
      ? { status: "ready", providerRef: null, url: req.knownUrl }
      : { status: "failed", providerRef: null, error: "No preview URL was reported for this build." };
  },
  async getDeploy() {
    return { status: "ready", providerRef: null, url: null };
  },
  async rollback(input) {
    return { status: "ready", providerRef: input.toProviderRef, url: input.site.domain ? `https://${input.site.domain}` : null };
  },
};

class NotImplementedHost implements HostProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly notes: string,
  ) {}
  private fail(): never {
    throw new Error(`${this.label} hosting isn't wired yet. ${this.notes}`);
  }
  async ensureProject(): Promise<{ hostRef: string | null }> {
    return this.fail();
  }
  async deploy(): Promise<DeployState> {
    return this.fail();
  }
  async getDeploy(): Promise<DeployState> {
    return this.fail();
  }
  async rollback(): Promise<DeployState> {
    return this.fail();
  }
}

// TODO(docs/18): Cloudflare Pages via REST — POST /accounts/{acct}/pages/projects
// (ensureProject, git-connected or direct upload), deployments list/get for
// getDeploy, POST .../deployments/{id}/rollback for rollback, custom domains via
// .../domains. Token: integration_credentials(provider='cloudflare'). Deploy
// notifications arrive through a Cloudflare Notifications webhook → parseWebhook.
export const cloudflarePagesHost = new NotImplementedHost(
  "cloudflare_pages",
  "Cloudflare Pages",
  "Use the manual host until the adapter lands (docs/18 checklist).",
);

// TODO(docs/18): Vercel REST — projects, deployments (target=production to
// promote), POST /v9/projects/{id}/promote/{deploymentId} or alias for
// rollback; webhook verify with x-vercel-signature (HMAC-SHA1). Commercial use
// needs a Pro team — Hobby is non-commercial.
export const vercelHost = new NotImplementedHost("vercel", "Vercel", "Use the manual host until the adapter lands (docs/18 checklist).");

export const noRepo: RepoProvider = {
  id: "manual",
  async ensureRepo(site) {
    return { repoRef: site.repoRef ?? site.slug };
  },
  async openChange() {
    return { ref: "manual", url: null };
  },
  async mergeChange() {
    return { commitSha: "" };
  },
};

// TODO(docs/18): GitHub RepoProvider — repo from a template repo per site
// (POST /repos/{template}/generate), branch per build, PR on build finish,
// squash-merge on approval → that commit is what production deploys.
