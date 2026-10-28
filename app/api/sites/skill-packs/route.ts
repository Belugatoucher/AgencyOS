import { NextResponse } from "next/server";
import { withViewer } from "@/lib/api";
import { isInternal } from "@/lib/access";
import { listSkillPacks } from "@/lib/sites/skill-packs";

// Installed skill packs (docs/18). Internal-only; paths are not returned.
export const GET = withViewer(async (_req, viewer) => {
  if (!isInternal(viewer)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const packs = await listSkillPacks();
  return NextResponse.json(packs.map(({ root: _root, ...p }) => p));
});
