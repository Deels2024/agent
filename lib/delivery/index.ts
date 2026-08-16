import { runtimeValue } from "../runtime";
import { calculateApiShipRates, createApiShipShipment, getApiShipPickupPoints, getApiShipShipmentStatuses } from "./apiship";
import { carrierLabel, supportedDeliveryNetwork } from "./catalog";
import type { DeliveryAddress, DeliveryRate, PackageSpec, ShipmentInput } from "./types";

export { carrierLabel, supportedDeliveryNetwork } from "./catalog";
export type { DeliveryAddress, DeliveryMethod, DeliveryRate, PackageSpec, PickupPoint, ShipmentInput, ShipmentParty, ShipmentResult, ShipmentStatusSnapshot } from "./types";

export function globalDeliveryToken() {
  return runtimeValue("APISHIP_API_TOKEN") ?? runtimeValue("DELIVERY_API_KEY");
}

export function isDeliveryNetworkConfigured(token = globalDeliveryToken()) {
  return Boolean(token);
}

export function demoDeliveryRates(input: { currentSellerPrice: number }): DeliveryRate[] {
  const sellerPrice = Math.max(0, input.currentSellerPrice || 0);
  const rates: DeliveryRate[] = [
    { provider: "fivepost", providerLabel: "5Post", serviceName: "Пункт выдачи рядом с домом", method: "pickup", tariffId: "demo-fivepost", price: 249, daysMin: 2, daysMax: 4, pickupPointIds: ["demo-1", "demo-2"], isDemo: true },
    { provider: "cdek", providerLabel: "СДЭК", serviceName: "Посылка до ПВЗ", method: "pickup", tariffId: "demo-cdek", price: 319, daysMin: 1, daysMax: 3, pickupPointIds: ["demo-3", "demo-4"], isDemo: true },
    { provider: "yandex", providerLabel: "Яндекс Доставка", serviceName: "Курьером до двери", method: "courier", tariffId: "demo-yandex", price: 549, daysMin: 1, daysMax: 2, pickupPointIds: [], isDemo: true },
    { provider: "seller_delivery", providerLabel: "Доставка продавца", serviceName: "Курьер магазина", method: "seller", tariffId: "seller", price: sellerPrice, daysMin: 1, daysMax: 3, pickupPointIds: [], isDemo: true },
  ];
  return rates.sort((left, right) => left.price - right.price || left.daysMax - right.daysMax);
}

export function sellerDeliveryRate(price: number): DeliveryRate {
  return { provider: "seller_delivery", providerLabel: carrierLabel("seller_delivery"), serviceName: "Курьер магазина", method: "seller", tariffId: "seller", price: Math.max(0, price), daysMin: 1, daysMax: 3, pickupPointIds: [], isDemo: false };
}

export async function calculateDeliveryRates(input: { token?: string; from: DeliveryAddress; to: DeliveryAddress; package: PackageSpec; assessedCost: number; currentSellerPrice: number; demo: boolean }) {
  if (input.demo) return demoDeliveryRates({ currentSellerPrice: input.currentSellerPrice });
  const rates = [sellerDeliveryRate(input.currentSellerPrice)];
  const token = input.token ?? globalDeliveryToken();
  if (token) rates.push(...await calculateApiShipRates(token, input));
  return rates.sort((left, right) => left.price - right.price || left.daysMax - right.daysMax).slice(0, 20);
}

export async function findPickupPoints(input: { token?: string; provider: string; city: string; allowedIds?: string[]; demo: boolean }) {
  if (input.demo) return [
    { id: "demo-1", provider: input.provider, name: "Пункт выдачи у метро", address: `${input.city}, центральный район, д. 12`, city: input.city, lat: null, lng: null, timetable: "Ежедневно 09:00–21:00", phone: null, type: "pickup" as const },
    { id: "demo-2", provider: input.provider, name: "Постамат в супермаркете", address: `${input.city}, проспект Покупателей, д. 8`, city: input.city, lat: null, lng: null, timetable: "Ежедневно 08:00–23:00", phone: null, type: "locker" as const },
  ];
  const token = input.token ?? globalDeliveryToken();
  if (!token) return [];
  return getApiShipPickupPoints(token, input);
}

export async function createDeliveryShipment(input: ShipmentInput & { token?: string; demo: boolean }) {
  if (input.demo) return { externalId: `demo-${crypto.randomUUID()}`, trackingNumber: null, trackingUrl: null, status: "sandbox_created" };
  if (["seller", "self_pickup"].includes(input.method) || input.provider === "seller_delivery") return { externalId: `seller-${input.orderNumber}`, trackingNumber: null, trackingUrl: null, status: "accepted" };
  const token = input.token ?? globalDeliveryToken();
  if (!token) throw new Error("delivery_provider_not_configured");
  return createApiShipShipment(token, input);
}

export async function getDeliveryShipmentStatuses(token: string, externalIds: string[]) {
  return getApiShipShipmentStatuses(token, externalIds);
}

export function deliveryConnectionSummary() {
  return {
    configured: isDeliveryNetworkConfigured(),
    gateway: "ApiShip",
    carriers: supportedDeliveryNetwork,
    features: ["расчёт цены и срока", "курьер и ПВЗ", "создание отправления", "трекинг", "резервная доставка продавца"],
  };
}
