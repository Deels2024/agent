import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { offers, searches } from "../../../db/schema";
import { requireActiveRequestIdentity } from "../../../lib/auth";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const db = getDb();
    const rows = await db.select().from(searches).where(eq(searches.userEmail, identity.email)).orderBy(desc(searches.createdAt), desc(searches.id)).limit(30);
    const url = new URL(request.url);
    const selectedId = Number(url.searchParams.get("searchId") || 0);
    const ownedSearch = selectedId ? rows.find((item) => item.id === selectedId) : null;
    const selectedOffers = ownedSearch ? await db.select().from(offers).where(eq(offers.searchId, selectedId)).orderBy(offers.price).limit(10) : [];
    return Response.json({ searches: rows, offers: selectedOffers });
  } catch {
    return Response.json({ error: "История пока недоступна" }, { status: 503 });
  }
}
