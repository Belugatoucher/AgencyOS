import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { projects, type Project } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

export const projectInput = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.enum(["active", "paused", "done"]).default("active"),
});

export async function listProjects(viewer: Viewer, accountId: string): Promise<Result<Project[]>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.accountId, accountId))
    .orderBy(desc(projects.createdAt));
  return ok(rows);
}

export async function createProject(
  viewer: Viewer,
  accountId: string,
  input: z.infer<typeof projectInput>,
): Promise<Result<Project>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, accountId)) {
    return err("forbidden", "Only the team can create projects");
  }
  const [row] = await db.insert(projects).values({ accountId, ...input }).returning();
  return ok(row!);
}

export async function updateProjectStatus(
  viewer: Viewer,
  projectId: string,
  status: z.infer<typeof projectInput>["status"],
): Promise<Result<Project>> {
  const [existing] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!existing || !canViewAccount(viewer, existing.accountId)) {
    return err("not_found", "Project not found");
  }
  if (!canMutateAccount(viewer, existing.accountId)) {
    return err("forbidden", "Only the team can edit projects");
  }
  const [row] = await db
    .update(projects)
    .set({ status })
    .where(eq(projects.id, projectId))
    .returning();
  return ok(row!);
}
