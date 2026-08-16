import { carrierLabel } from "./catalog";
import type { DeliveryAddress, DeliveryRate, PackageSpec, PickupPoint, ShipmentInput, ShipmentResult, ShipmentStatusSnapshot } from "./types";

const baseUrl = "https://api.apiship.ru/v1";

type ApiShipTariff = {
  tariffId?: string | number;
  tariffProviderId?: string | number;
  tariffName?: string;
  deliveryCost?: number;
  calendarDaysMin?: number;
  calendarDaysMax?: number;
  workDaysMin?: number;
  workDaysMax?: number;
  daysMin?: number;
  daysMax?: number;
  pointIds?: Array<string | number>;
};

type ApiShipTariffGroup = { providerKey?: string; tariffs?: ApiShipTariff[] };

async function request<T>(token: string, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(baseUrl + path, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: token,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const payload = await response.json().catch(() => ({})) as T & { message?: string; description?: string };
    if (!response.ok) throw new Error(`delivery_provider_${response.status}:${payload.message ?? payload.description ?? "request_failed"}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function apiAddress(address: DeliveryAddress) {
  return {
    countryCode: address.countryCode || "RU",
    ...(address.postalCode ? { index: address.postalCode } : {}),
    ...(address.region ? { region: address.region } : {}),
    city: address.city,
    addressString: address.addressLine,
    ...(Number.isFinite(address.lat) && Number.isFinite(address.lng) ? { lat: address.lat, lng: address.lng } : {}),
  };
}

function normalizedRate(provider: string, tariff: ApiShipTariff, method: "courier" | "pickup"): DeliveryRate | null {
  const price = Number(tariff.deliveryCost);
  const tariffId = String(tariff.tariffId ?? tariff.tariffProviderId ?? "");
  if (!Number.isFinite(price) || price < 0 || !tariffId) return null;
  const daysMin = Math.max(0, Number(tariff.calendarDaysMin ?? tariff.workDaysMin ?? tariff.daysMin ?? 1) || 1);
  const daysMax = Math.max(daysMin, Number(tariff.calendarDaysMax ?? tariff.workDaysMax ?? tariff.daysMax ?? daysMin) || daysMin);
  return {
    provider,
    providerLabel: carrierLabel(provider),
    serviceName: tariff.tariffName || (method === "pickup" ? "До пункта выдачи" : "Курьером до двери"),
    method,
    tariffId,
    price: Math.round(price * 100) / 100,
    daysMin,
    daysMax,
    pickupPointIds: (tariff.pointIds ?? []).map(String),
    isDemo: false,
  };
}

export async function calculateApiShipRates(token: string, input: { from: DeliveryAddress; to: DeliveryAddress; package: PackageSpec; assessedCost: number }) {
  const payload = await request<{ deliveryToDoor?: ApiShipTariffGroup[]; deliveryToPoint?: ApiShipTariffGroup[] }>(token, "/calculator", {
    method: "POST",
    body: JSON.stringify({
      from: apiAddress(input.from),
      to: apiAddress(input.to),
      places: [{ weight: input.package.weightGrams, length: input.package.lengthCm, width: input.package.widthCm, height: input.package.heightCm }],
      assessedCost: Math.max(0, input.assessedCost),
      codCost: 0,
      includeFees: true,
      pickupTypes: [1, 2],
      deliveryTypes: [1, 2],
      timeout: 8_000,
    }),
  });
  const rates: DeliveryRate[] = [];
  for (const [groups, method] of [[payload.deliveryToDoor, "courier"], [payload.deliveryToPoint, "pickup"]] as const) {
    for (const group of groups ?? []) {
      const provider = group.providerKey?.trim();
      if (!provider) continue;
      for (const tariff of group.tariffs ?? []) {
        const rate = normalizedRate(provider, tariff, method);
        if (rate) rates.push(rate);
      }
    }
  }
  return rates.sort((left, right) => left.price - right.price || left.daysMax - right.daysMax).slice(0, 20);
}

export async function getApiShipPickupPoints(token: string, input: { provider: string; city: string; allowedIds?: string[] }) {
  const filter = [`city=${input.city}`, `providerKey=${input.provider}`, "availableOperation=[2,3]"];
  if (input.allowedIds?.length && input.allowedIds.length <= 30) filter.push(`id=[${input.allowedIds.join(",")}]`);
  const query = new URLSearchParams({ limit: "50", offset: "0", stateCheckOff: "false", filter: filter.join(";") });
  const payload = await request<{ rows?: Array<Record<string, unknown>> }>(token, `/lists/points?${query.toString()}`);
  return (payload.rows ?? []).map((point): PickupPoint => ({
    id: String(point.id ?? point.code ?? ""),
    provider: String(point.providerKey ?? input.provider),
    name: String(point.name ?? "Пункт выдачи"),
    address: String(point.address ?? ""),
    city: String(point.city ?? input.city),
    lat: Number.isFinite(Number(point.lat)) ? Number(point.lat) : null,
    lng: Number.isFinite(Number(point.lng)) ? Number(point.lng) : null,
    timetable: typeof point.timetable === "string" ? point.timetable : null,
    phone: typeof point.phone === "string" ? point.phone : null,
    type: point.type === 2 ? "locker" : point.type === 3 ? "post_office" : point.type === 4 ? "terminal" : "pickup",
  })).filter((point) => point.id && point.address);
}

export async function createApiShipShipment(token: string, input: ShipmentInput): Promise<ShipmentResult> {
  const payload = await request<{ orderId?: string | number; providerNumber?: string | null }>(token, "/orders", {
    method: "POST",
    body: JSON.stringify({
      recipient: {
        countryCode: input.recipient.countryCode,
        contactName: input.recipient.contactName,
        phone: input.recipient.phone,
        email: input.recipient.email || undefined,
        region: input.recipient.region || undefined,
        city: input.recipient.city,
        index: input.recipient.postalCode || undefined,
        addressString: input.recipient.addressLine,
      },
      order: {
        clientNumber: input.orderNumber,
        providerKey: input.provider,
        tariffId: Number(input.tariffId),
        pickupType: 1,
        deliveryType: input.method === "pickup" ? 2 : 1,
        pointOutId: input.method === "pickup" && input.pickupPointId ? Number(input.pickupPointId) : undefined,
        weight: input.package.weightGrams,
        length: input.package.lengthCm,
        width: input.package.widthCm,
        height: input.package.heightCm,
      },
      sender: {
        countryCode: input.sender.countryCode,
        contactName: input.sender.contactName,
        phone: input.sender.phone,
        region: input.sender.region || undefined,
        city: input.sender.city,
        index: input.sender.postalCode || undefined,
        addressString: input.sender.addressLine,
      },
      cost: { assessedCost: input.itemCost, codCost: 0, deliveryCost: input.deliveryCost },
      places: [{
        weight: input.package.weightGrams,
        length: input.package.lengthCm,
        width: input.package.widthCm,
        height: input.package.heightCm,
        items: [{ quantity: 1, articul: input.orderNumber, assessedCost: input.itemCost, description: input.itemName, cost: input.itemCost }],
      }],
    }),
  });
  if (!payload.orderId) throw new Error("delivery_provider_invalid_response");
  return {
    externalId: String(payload.orderId),
    trackingNumber: payload.providerNumber ? String(payload.providerNumber) : null,
    trackingUrl: null,
    status: "created",
  };
}

function normalizedDeliveryStatus(value: unknown) {
  const key = String(value ?? "").replace(/[^a-z]/gi, "").toLowerCase();
  if (["uploading", "uploaded", "created", "accepted"].includes(key)) return "accepted";
  if (["pickup", "pickupready", "pickedup", "onway", "outfordelivery", "delivering", "transit"].includes(key)) return "in_transit";
  if (["deliveredtopoint", "readyforpickup", "readyfordelivery", "deliveryready"].includes(key)) return "ready_for_pickup";
  if (["delivered", "completed"].includes(key)) return "delivered";
  if (["canceled", "cancelled", "returned"].includes(key)) return "cancelled";
  if (key === "lost") return "lost";
  if (["uploadingerror", "error"].includes(key)) return "problem";
  return null;
}

export async function getApiShipShipmentStatuses(token: string, externalIds: string[]): Promise<ShipmentStatusSnapshot[]> {
  const orderIds = externalIds.map(Number).filter((value) => Number.isInteger(value) && value > 0).slice(0, 100);
  if (!orderIds.length) return [];
  const payload = await request<{ succeedOrders?: Array<{ orderInfo?: Record<string, unknown>; status?: Record<string, unknown> }> }>(token, "/orders/statuses", {
    method: "POST",
    body: JSON.stringify({ orderIds }),
  });
  return (payload.succeedOrders ?? []).map((item) => {
    const info = item.orderInfo ?? {};
    const status = item.status ?? {};
    const rawStatus = String(status.key ?? "");
    return {
      externalId: String(info.orderId ?? ""),
      provider: info.providerKey ? String(info.providerKey) : null,
      providerNumber: info.providerNumber ? String(info.providerNumber) : null,
      trackingUrl: info.trackingUrl ? String(info.trackingUrl) : null,
      rawStatus,
      status: normalizedDeliveryStatus(rawStatus),
    };
  }).filter((item) => item.externalId);
}
