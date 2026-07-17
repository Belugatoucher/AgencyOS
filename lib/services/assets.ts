import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { assets, assetUsage, files, users, type Asset } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { getQueue } from "@/lib/queues";

export const ASSET_TYPES = ["logo", "photo", "video", "raw", "font", "doc", "export"] as const;
export const ASSET_STATUSES = ["draft", "in_review", "approved", "archived"] as const;

// Register an already-uploaded file (via the shared presigned flow) as an asset.
export const registerAssetInput = z.object({
  accountId: z.string().uuid(),
  fileId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  type: z.enum(ASSET_TYPES),
  tags: z.array(z.string().max(50)).max(30).default([]),
  rightsNote: z.string().max(2000).nullish(),
  expiresAt: z.coerce.date().nullish(),
});

export const updateAssetInput = z.object({
  status: z.enum(ASSET_STATUSES).optional(),
  assigneeId: z.string().uuid().nullish(),
  tags: z.array(z.string().max(50)).max(30).optional(),
  rightsNote: z.string().max(2000).nullish(),
  expiresAt: z.coerce.date().nullish(),
  type: z.enum(ASSET_TYPES).optional(),
});

export const assetFilters = z.object({
  account: z.string().uuid().optional(),
  type: z.enum(ASSET_TYPES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  tag: z.string().max(50).optional(),
  q: z.string().max(200).optional(),
});

export type AssetWithFile = Asset & {
  filename: string;
  mime: string;
  sizeBytes: number;
  r2Key: string;
  assigneeName: string | null;
};

export async function listAssets(
  viewer: Viewer,
  filters: z.infer<typeof assetFilters>,
): Promise<Result<AssetWithFile[]>> {
  const conds: (SQL | undefined)[] = [];
  if (filters.account) {
    if (!canViewAccount(viewer, filters.account)) return err("not_found", "Account not found");
    conds.push(eq(assets.accountId, filters.account));
  } else if (viewer.role === "client") {
    // clients only ever see their own accounts' assets
    const { accessibleAccountIds } = await import("@/lib/access");
    const ids = accessibleAccountIds(viewer);
    if (ids === "all" || ids.length === 0) return ok([]);
    conds.push(inArray(assets.accountId, [...ids]));
  }
  if (filters.type) conds.push(eq(assets.type, filters.type));
  if (filters.status) conds.push(eq(assets.status, filters.status));
  if (filters.tag) conds.push(sql`${filters.tag} = any(${assets.tags})`);
  if (filters.q) {
    conds.push(or(ilike(files.filename, `%${filters.q}%`), sql`${filters.q} = any(${assets.tags})`));
  }

  const rows = await db
    .select({
      asset: assets,
      filename: files.filename,
      mime: files.mime,
      sizeBytes: files.sizeBytes,
      r2Key: files.r2Key,
      assigneeName: users.name,
    })
    .from(assets)
    .innerJoin(files, eq(files.id, assets.fileId))
    .leftJoin(users, eq(users.id, assets.assigneeId))
    .where(conds.length ? and(...conds.filter(Boolean)) : undefined)
    .orderBy(desc(assets.createdAt));

  return ok(rows.map((r) => ({ ...r.asset, filename: r.filename, mime: r.mime, sizeBytes: r.sizeBytes, r2Key: r.r2Key, assigneeName: r.assigneeName })));
}

export type RegisterResult = { asset: Asset; duplicateOf?: string };

export async function registerAsset(
  viewer: Viewer,
  input: z.infer<typeof registerAssetInput>,
): Promise<Result<RegisterResult>> {
  if (!canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, input.accountId)) {
    return err("forbidden", "Only the team can add assets");
  }
  const [file] = await db.select().from(files).where(eq(files.id, input.fileId));
  if (!file || file.accountId !== input.accountId) return err("invalid", "File not found for account");

  // Dedup: same checksum in the same account → warn + offer to link (docs/05).
  let duplicateOf: string | undefined;
  if (file.checksum) {
    const dupe = await db
      .select({ id: assets.id })
      .from(assets)
      .innerJoin(files, eq(files.id, assets.fileId))
      .where(and(eq(assets.accountId, input.accountId), eq(files.checksum, file.checksum)))
      .limit(1);
    if (dupe.length) duplicateOf = dupe[0]!.id;
  }

  const [asset] = await db
    .insert(assets)
    .values({
      accountId: input.accountId,
      fileId: input.fileId,
      projectId: input.projectId ?? null,
      type: input.type,
      tags: input.tags,
      rightsNote: input.rightsNote ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();

  // Enqueue thumbnail generation (media queue) for image/video.
  if (file.mime.startsWith("image/") || file.mime.startsWith("video/")) {
    await getQueue("media").add("asset-thumbnail", { assetId: asset!.id });
  }

  return ok({ asset: asset!, duplicateOf });
}

async function loadAsset(id: string): Promise<Asset | null> {
  const [row] = await db.select().from(assets).where(eq(assets.id, id));
  return row ?? null;
}

export async function updateAsset(
  viewer: Viewer,
  id: string,
  input: z.infer<typeof updateAssetInput>,
): Promise<Result<Asset>> {
  const asset = await loadAsset(id);
  if (!asset || !canViewAccount(viewer, asset.accountId)) return err("not_found", "Asset not found");
  if (!canMutateAccount(viewer, asset.accountId)) return err("forbidden", "Only the team can edit assets");

  const patch: Partial<typeof assets.$inferInsert> = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId ?? null;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.rightsNote !== undefined) patch.rightsNote = input.rightsNote ?? null;
  if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt ?? null;
  if (input.type !== undefined) patch.type = input.type;
  if (Object.keys(patch).length === 0) return ok(asset);

  const [row] = await db.update(assets).set(patch).where(eq(assets.id, id)).returning();

  // Assigning a draft asset spawns an auto-task in the assignee's queue (docs/05).
  if (input.assigneeId && input.assigneeId !== asset.assigneeId) {
    const { tasks } = await import("@/lib/db/schema");
    await db.insert(tasks).values({
      accountId: asset.accountId,
      title: `Work asset: ${row!.type}`,
      assigneeId: input.assigneeId,
      status: "todo",
      source: "asset",
      sourceId: id,
    });
  }
  return ok(row!);
}

// ===== Usage backlinks (docs/05) =====

export async function recordUsage(assetId: string, usedIn: string, usedInId: string): Promise<void> {
  await db.insert(assetUsage).values({ assetId, usedIn, usedInId });
}

export async function getUsage(
  viewer: Viewer,
  id: string,
): Promise<Result<(typeof assetUsage.$inferSelect)[]>> {
  const asset = await loadAsset(id);
  if (!asset || !canViewAccount(viewer, asset.accountId)) return err("not_found", "Asset not found");
  return ok(await db.select().from(assetUsage).where(eq(assetUsage.assetId, id)));
}
