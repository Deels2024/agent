import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { users } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const body = await request.json() as { portal?: unknown };
    const portal = body.portal === "seller" ? "seller" : body.portal === "buyer" ? "buyer" : null;
    if (!portal) return Response.json({ error: "Выберите кабинет покупателя или продавца" }, { status: 400 });
    const db = getDb();
    const [profile] = await db.select({ role: users.role }).from(users).where(eq(users.email, identity.email)).limit(1);
    if (!profile) return Response.json({ error: "Сначала завершите регистрацию" }, { status: 428 });
    const changed = profile.role !== portal;
    if (changed) {
      await db.update(users).set({ role: portal, updatedAt: new Date().toISOString() }).where(eq(users.email, identity.email));
      await writeAudit(request, { actorEmail: identity.email, action: "account.portal_selected", entityType: "user", entityId: identity.email, metadata: { portal } });
    }
    return Response.json({ portal, changed });
  } catch {
    return Response.json({ error: "Не удалось запомнить выбранный кабинет" }, { status: 503 });
  }
}
