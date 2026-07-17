import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  assets,
  collectionAssets,
  collections,
  files,
  shareLinks,
  type Collection,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

export const collectionInput = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  isBrandKit: z.boolean().default(false),
  isDropbox: z.boolean().default(false),
});

export async function listCollections(
  viewer: Viewer,
  accountId: string,
): Promise<Result<Collection[]>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  return ok(
    await db.select().from(collections).where(eq(collections.accountId, accountId)),
  );
}

export async function createCollection(
  viewer: Viewer,
  input: z.infer<typeof collectionInput>,
): Promise<Result<Collection>> {
  if (!canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, input.accountId)) return err("forbidden", "Only the team can create collections");
  const [row] = await db.insert(collections).values(input).returning();
  return ok(row!);
}

async function loadCollection(id: string): Promise<Collection | null> {
  const [row] = await db.select().from(collections).where(eq(collections.id, id));
  return row ?? null;
}

export async function addAssetToCollection(
  viewer: Viewer,
  collectionId: string,
  assetId: string,
): Promise<Result<{ added: true }>> {
  const collection = await loadCollection(collectionId);
  if (!collection || !canViewAccount(viewer, collection.accountId)) {
    return err("not_found", "Collection not found");
  }
  if (!canMutateAccount(viewer, collection.accountId)) return err("forbidden", "Only the team can edit collections");
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset || asset.accountId !== collection.accountId) return err("invalid", "Asset not in this account");
  await db.insert(collectionAssets).values({ collectionId, assetId }).onConflictDoNothing();
  return ok({ added: true });
}

export type CollectionDetail = {
  collection: Collection;
  assets: { id: string; type: string; thumbKey: string | null; filename: string }[];
};

export async function getCollection(viewer: Viewer, id: string): Promise<Result<CollectionDetail>> {
  const collection = await loadCollection(id);
  if (!collection || !canViewAccount(viewer, collection.accountId)) {
    return err("not_found", "Collection not found");
  }
  const rows = await db
    .select({ id: assets.id, type: assets.type, thumbKey: assets.thumbKey, filename: files.filename })
    .from(collectionAssets)
    .innerJoin(assets, eq(assets.id, collectionAssets.assetId))
    .innerJoin(files, eq(files.id, assets.fileId))
    .where(eq(collectionAssets.collectionId, id));
  return ok({ collection, assets: rows });
}

// ===== Share links (same signed-link service as Review) =====

export const shareInput = z.object({
  expiresInDays: z.number().int().min(1).max(90).default(14),
  pin: z.string().regex(/^\d{4}$/).optional(),
  canComment: z.boolean().default(false),
});

export async function shareCollection(
  viewer: Viewer,
  collectionId: string,
  input: z.infer<typeof shareInput>,
): Promise<Result<{ token: string; url: string }>> {
  const collection = await loadCollection(collectionId);
  if (!collection || !canViewAccount(viewer, collection.accountId)) {
    return err("not_found", "Collection not found");
  }
  if (!canMutateAccount(viewer, collection.accountId)) return err("forbidden", "Only the team can share");
  // ≥128-bit CSPRNG token (audit item 1)
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  await db.insert(shareLinks).values({
    token,
    kind: "collection",
    targetId: collectionId,
    pin: input.pin ?? null,
    canComment: input.canComment,
    expiresAt,
    createdBy: viewer.id,
  });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return ok({ token, url: `${base}/s/${token}` });
}
