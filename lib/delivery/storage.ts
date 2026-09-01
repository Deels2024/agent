import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { deliveryConnections, inventoryItems, quotes, sellerDeliveryProfiles } from "../../db/schema";
import { decryptCredentials } from "../security";
import { globalDeliveryToken } from ".";
import type { DeliveryAddress, PackageSpec, ShipmentParty } from "./types";

export async function deliveryTokenForSeller(sellerId: number | null | undefined) {
  if (sellerId) {
    const [connection] = await getDb().select().from(deliveryConnections).where(and(eq(deliveryConnections.sellerId, sellerId), eq(deliveryConnections.provider, "apiship"))).limit(1);
    if (connection?.secretCiphertext && connection.secretIv) {
      try {
        const credentials = await decryptCredentials(connection.secretCiphertext, connection.secretIv);
        if (credentials.apiToken) return credentials.apiToken;
      } catch {
        // A platform token can safely serve as a fallback while a seller rotates credentials.
      }
    }
  }
  return globalDeliveryToken();
}

export async function packageForOrder(quotePublicId: string | null, demo: boolean): Promise<PackageSpec | null> {
  if (quotePublicId) {
    const [quote] = await getDb().select({ inventoryItemId: quotes.inventoryItemId }).from(quotes).where(eq(quotes.publicId, quotePublicId)).limit(1);
    if (quote?.inventoryItemId) {
      const [item] = await getDb().select({ weightGrams: inventoryItems.weightGrams, lengthCm: inventoryItems.lengthCm, widthCm: inventoryItems.widthCm, heightCm: inventoryItems.heightCm }).from(inventoryItems).where(eq(inventoryItems.id, quote.inventoryItemId)).limit(1);
      if (item && [item.weightGrams, item.lengthCm, item.widthCm, item.heightCm].every((value) => Number.isInteger(value) && Number(value) > 0)) {
        return { weightGrams: item.weightGrams!, lengthCm: item.lengthCm!, widthCm: item.widthCm!, heightCm: item.heightCm! };
      }
    }
  }
  return demo ? { weightGrams: 1_200, lengthCm: 32, widthCm: 24, heightCm: 16 } : null;
}

export async function senderForSeller(sellerId: number | null | undefined): Promise<ShipmentParty | null> {
  if (!sellerId) return null;
  const [profile] = await getDb().select().from(sellerDeliveryProfiles).where(eq(sellerDeliveryProfiles.sellerId, sellerId)).limit(1);
  if (!profile) return null;
  return {
    contactName: profile.contactName,
    phone: profile.phone,
    countryCode: profile.countryCode,
    postalCode: profile.postalCode,
    region: profile.region,
    city: profile.city,
    addressLine: profile.addressLine,
  };
}

export function publicAddress(value: { countryCode: string; postalCode: string | null; region: string | null; city: string; addressLine: string }): DeliveryAddress {
  return { countryCode: value.countryCode, postalCode: value.postalCode, region: value.region, city: value.city, addressLine: value.addressLine };
}
