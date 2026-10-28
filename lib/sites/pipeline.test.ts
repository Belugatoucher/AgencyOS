import { describe, expect, it } from "vitest";
import {
  canDecideBuild,
  canRequestBuild,
  canSetStage,
  canStartIntake,
  deriveStage,
  expiryStatus,
  isPrivateHost,
  nextActions,
  normalizeSiteUrl,
  slugify,
  worstHealth,
  type PipelineFacts,
} from "./pipeline";

const base: PipelineFacts = {
  stage: "intake",
  snapshot: null,
  design: null,
  hasApprovedDesign: false,
  build: null,
  productionDeploy: null,
  hasLiveProduction: false,
  checks: [],
};

describe("deriveStage", () => {
  it("starts at intake and moves to design once a crawl is done", () => {
    expect(deriveStage(base)).toBe("intake");
    expect(deriveStage({ ...base, snapshot: { id: "s", status: "running" } })).toBe("intake");
    expect(deriveStage({ ...base, snapshot: { id: "s", status: "done" } })).toBe("design");
  });

  it("needs an approved design to reach build, a reviewable build to reach review", () => {
    const proposed = { ...base, design: { id: "d", version: 1, status: "proposed" as const } };
    expect(deriveStage(proposed)).toBe("design");
    expect(deriveStage({ ...proposed, hasApprovedDesign: true })).toBe("build");
    expect(
      deriveStage({ ...proposed, hasApprovedDesign: true, build: { id: "b", kind: "initial", status: "awaiting_review" } }),
    ).toBe("review");
  });

  it("stays live once production is up, and keeps paused/archived sticky", () => {
    const live = { ...base, hasLiveProduction: true, build: { id: "b", kind: "optimize" as const, status: "running" as const } };
    expect(deriveStage(live)).toBe("live");
    expect(deriveStage({ ...live, stage: "paused" })).toBe("paused");
    expect(deriveStage({ ...live, stage: "archived" })).toBe("archived");
  });
});

describe("gates", () => {
  it("blocks a second crawl while one is running", () => {
    expect(canStartIntake({ stage: "intake", snapshot: { id: "s", status: "running" } }).ok).toBe(false);
    expect(canStartIntake({ stage: "intake", snapshot: { id: "s", status: "failed" } }).ok).toBe(true);
  });

  it("requires an approved design for the initial build and a live site for changes", () => {
    expect(canRequestBuild(base, "initial")).toEqual({ ok: false, reason: "Approve a design system first." });
    expect(canRequestBuild({ ...base, hasApprovedDesign: true }, "initial").ok).toBe(true);
    expect(canRequestBuild({ ...base, hasApprovedDesign: true }, "optimize").ok).toBe(false);
    expect(canRequestBuild({ ...base, hasLiveProduction: true, stage: "live" }, "change").ok).toBe(true);
    expect(
      canRequestBuild({ ...base, hasApprovedDesign: true, build: { id: "b", kind: "initial", status: "running" } }, "initial").ok,
    ).toBe(false);
  });

  it("only decides builds that are awaiting review", () => {
    expect(canDecideBuild("awaiting_review").ok).toBe(true);
    expect(canDecideBuild("running").ok).toBe(false);
  });

  it("only allows pausing, archiving and resuming by hand", () => {
    expect(canSetStage("live", "paused")).toBe(true);
    expect(canSetStage("paused", "live")).toBe(true);
    expect(canSetStage("intake", "live")).toBe(false);
    expect(canSetStage("design", "archived")).toBe(true);
  });
});

describe("nextActions", () => {
  it("asks for intake first", () => {
    expect(nextActions(base)[0]!.kind).toBe("start_intake");
  });

  it("puts reviews and health failures ahead of everything else", () => {
    const acts = nextActions({
      ...base,
      hasLiveProduction: true,
      build: { id: "b9", kind: "optimize", status: "awaiting_review" },
      checks: [{ kind: "ssl", status: "fail", summary: "expires in 3 days" }, { kind: "uptime", status: "ok", summary: "200" }],
    });
    expect(acts.map((a) => a.kind)).toEqual(["fix_health", "review_build"]);
    expect(acts[1]!.ref).toBe("b9");
  });

  it("says all good for a healthy live site", () => {
    expect(nextActions({ ...base, hasLiveProduction: true, checks: [{ kind: "uptime", status: "ok", summary: "" }] })).toEqual([
      { kind: "none", label: "All good", priority: 0 },
    ]);
  });
});

describe("health helpers", () => {
  it("rolls up the worst status", () => {
    expect(worstHealth([])).toBe("unknown");
    expect(worstHealth(["ok", "warn", "ok"])).toBe("warn");
    expect(worstHealth(["ok", "unknown"])).toBe("unknown");
    expect(worstHealth(["warn", "fail"])).toBe("fail");
  });

  it("grades expiry windows", () => {
    expect(expiryStatus(3)).toBe("fail");
    expect(expiryStatus(14)).toBe("warn");
    expect(expiryStatus(60)).toBe("ok");
  });
});

describe("url + slug helpers", () => {
  it("normalises bare domains and rejects private hosts", () => {
    expect(normalizeSiteUrl("example.com/about#team")).toEqual({ ok: true, url: "https://example.com/about", hostname: "example.com" });
    expect(normalizeSiteUrl("ftp://example.com").ok).toBe(false);
    expect(normalizeSiteUrl("http://localhost:3000").ok).toBe(false);
    expect(normalizeSiteUrl("http://192.168.1.10").ok).toBe(false);
  });

  it("flags private and link-local literals", () => {
    for (const h of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.20.1.1", "[::1]", "intranet", "printer.local"])
      expect(isPrivateHost(h)).toBe(true);
    for (const h of ["8.8.8.8", "example.com", "172.32.0.1"]) expect(isPrivateHost(h)).toBe(false);
  });

  it("slugifies names", () => {
    expect(slugify("Granite Oak Waste Solutions!")).toBe("granite-oak-waste-solutions");
    expect(slugify("Café Déjà")).toBe("cafe-deja");
    expect(slugify("***")).toBe("site");
  });
});
