import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { deliveries, orders, sellers } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const [seller] = await getDb().select().from(sellers).where(eq(sellers.ownerEmail, identity.email)).limit(1);
    if (!seller) return Response.json({ orders: [] });
    const rows = await getDb().select({
      id: orders.id,
      publicId: orders.publicId,
      productName: orders.productName,
      itemAmount: orders.itemAmount,
      deliveryAmount: orders.deliveryAmount,
      amount: orders.amount,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      deliveryStatus: orders.deliveryStatus,
      isDemo: orders.isDemo,
      createdAt: orders.createdAt,
      deliveryId: deliveries.id,
      deliveryProvider: deliveries.provider,
      deliveryMethod: deliveries.method,
      deliveryServiceName: deliveries.serviceName,
      pickupPointJson: deliveries.pickupPointJson,
      recipientJson: deliveries.recipientJson,
      trackingNumber: deliveries.trackingNumber,
    }).from(orders).leftJoin(deliveries, eq(deliveries.orderId, orders.id)).where(eq(orders.sellerId, seller.id)).orderBy(desc(orders.createdAt)).limit(100);
    return Response.json({ orders: rows });
  } catch {
    return Response.json({ error: "Заказы временно недоступны" }, { status: 503 });
  }
}
