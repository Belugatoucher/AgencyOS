import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { skillPackManifest, type SkillPackManifest, type SkillPhase } from "@/lib/sites/types";

// Skill-pack registry (docs/18): reads skills/sites/*/pack.json. A broken
// manifest is reported, not thrown, so one bad pack can't hide the others.

export const SKILL_ROOT = path.join(process.cwd(), "skills", "sites");

export type SkillPackListing = SkillPackManifest & { root: string } | { id: string; invalid: string; root: string };

export async function listSkillPacks(root = SKILL_ROOT): Promise<SkillPackListing[]> {
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out: SkillPackListing[] = [];
  for (const dir of dirs.sort()) {
    const packRoot = path.join(root, dir);
    try {
      const manifest = skillPackManifest.parse(JSON.parse(await readFile(path.join(packRoot, "pack.json"), "utf8")));
      if (manifest.id !== dir) throw new Error(`id "${manifest.id}" doesn't match folder "${dir}"`);
      out.push({ ...manifest, root: packRoot });
    } catch (e) {
      out.push({ id: dir, invalid: e instanceof Error ? e.message : "unreadable manifest", root: packRoot });
    }
  }
  return out;
}

export type ResolvedPack = { id: string; version: string; phase: SkillPhase; root: string; entry: string };

/** The pack + entry a build should use, or a human reason it can't. */
export async function resolveSkillPack(
  id: string,
  phase: SkillPhase,
  root = SKILL_ROOT,
): Promise<{ ok: true; pack: ResolvedPack } | { ok: false; reason: string }> {
  const pack = (await listSkillPacks(root)).find((p) => p.id === id);
  if (!pack) return { ok: false, reason: `Skill pack "${id}" isn't installed.` };
  if ("invalid" in pack) return { ok: false, reason: `Skill pack "${id}" has a broken manifest: ${pack.invalid}` };
  if (!pack.enabled) return { ok: false, reason: `Skill pack "${pack.name}" is disabled: ${pack.disabledReason ?? "no reason given"}` };
  const entry = pack.phases[phase];
  if (!entry) return { ok: false, reason: `Skill pack "${pack.name}" has no ${phase} phase.` };
  return { ok: true, pack: { id: pack.id, version: pack.version, phase, root: path.relative(process.cwd(), pack.root), entry } };
}
