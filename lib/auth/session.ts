import { auth } from "@/lib/auth";
import { loadViewer, type Viewer } from "@/lib/access";

export async function currentViewer(): Promise<Viewer | null> {
  const session = await auth();
  if (!session?.user) return null;
  return loadViewer({ id: session.user.id, role: session.user.role });
}
