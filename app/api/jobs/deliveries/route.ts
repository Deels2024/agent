import { and, eq, isNotNull, ne, notInArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { deliveries, notifications, orders } from "../../../../db/schema";
import { getDeliveryShipmentStatuses } from "../../../../lib/delivery";
import { deliveryTokenForSeller } from "../../../../lib/delivery/storage";
import { runtimeValue } from "../../../../lib/runtime";

function authorized(request: Request) {
  const expected = runtimeValue("CRON_SECRET");
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && expected === actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Недостаточно прав" }, { status: 401 });
  try {
    await ensureMarketplaceSchema();
    const rows = await getDb().select({
      deliveryId: deliveries.id,
      externalId: deliveries.externalId,
      deliveryStatus: deliveries.status,
      trackingNumber: deliveries.trackingNumber,
      trackingUrl: deliveries.trackingUrl,
      orderId: orders.id,
      orderPublicId: orders.publicId,
      buyerEmail: orders.buyerEmail,
      sellerId: orders.sellerId,
      orderStatus: orders.status,
    }).from(deliveries).innerJoin(orders, eq(orders.id, deliveries.orderId)).where(and(
      isNotNull(deliveries.externalId),
      ne(deliveries.provider, "seller_delivery"),
      notInArray(deliveries.status, ["delivered", "cancelled", "lost", "sandbox_created"]),
    )).limit(60);

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = String(row.sellerId ?? "platform");
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    let updated = 0;
    let failed = 0;
    for (const group of groups.values()) {
      const token = await deliveryTokenForSeller(group[0]?.sellerId);
      if (!token) { failed += group.length; continue; }
      try {
        const snapshots = await getDeliveryShipmentStatuses(token, group.flatMap((row) => row.externalId ? [row.externalId] : []));
        const byId = new Map(snapshots.map((snapshot) => [snapshot.externalId, snapshot]));
        for (const row of group) {
          const snapshot = row.externalId ? byId.get(row.externalId) : undefined;
          if (!snapshot) continue;
          const nextStatus = snapshot.status ?? row.deliveryStatus;
          const nextTrackingNumber = snapshot.providerNumber || row.trackingNumber;
          const nextTrackingUrl = snapshot.trackingUrl || row.trackingUrl;
          const changed = nextStatus !== row.deliveryStatus || nextTrackingNumber !== row.trackingNumber || nextTrackingUrl !== row.trackingUrl;
          if (!changed) continue;
          await getDb().update(deliveries).set({ status: nextStatus, trackingNumber: nextTrackingNumber, trackingUrl: nextTrackingUrl, updatedAt: new Date().toISOString() }).where(eq(deliveries.id, row.deliveryId));
          await getDb().update(orders).set({ deliveryStatus: nextStatus, status: nextStatus === "delivered" ? "delivered" : row.orderStatus, updatedAt: new Date().toISOString() }).where(eq(orders.id, row.orderId));
          await getDb().insert(notifications).values({ recipientEmail: row.buyerEmail, template: "delivery_status_changed", payloadJson: JSON.stringify({ orderId: row.orderPublicId, status: nextStatus, rawStatus: snapshot.rawStatus, trackingNumber: snapshot.providerNumber, trackingUrl: snapshot.trackingUrl }) });
          updated += 1;
        }
      } catch {
        failed += group.length;
      }
    }
    return Response.json({ checked: rows.length, updated, failed });
  } catch {
    return Response.json({ error: "Не удалось обновить статусы доставки" }, { status: 503 });
  }
}
