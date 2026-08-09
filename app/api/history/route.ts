import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { offers, searches } from "../../../db/schema";

export async function GET(request: Request) {
  try {
    await ensureMarketplaceSchema();
    const db = getDb();
    const rows = await db.select().from(searches).orderBy(desc(searches.createdAt), desc(searches.id)).limit(30);
    const url = new URL(request.url);
    const selectedId = Number(url.searchParams.get("searchId") || 0);
    const selectedOffers = selectedId ? await db.select().from(offers).where(eq(offers.searchId, selectedId)).orderBy(offers.price).limit(10) : [];
    return Response.json({ searches: rows, offers: selectedOffers });
  } catch {
    return Response.json({ error: "История пока недоступна" }, { status: 503 });
  }
}
