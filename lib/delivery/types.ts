export type DeliveryMethod = "courier" | "pickup" | "seller" | "self_pickup";

export type DeliveryAddress = {
  countryCode: string;
  postalCode?: string | null;
  region?: string | null;
  city: string;
  addressLine: string;
  lat?: number | null;
  lng?: number | null;
};

export type PackageSpec = {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type DeliveryRate = {
  provider: string;
  providerLabel: string;
  serviceName: string;
  method: DeliveryMethod;
  tariffId: string;
  price: number;
  daysMin: number;
  daysMax: number;
  pickupPointIds: string[];
  isDemo: boolean;
};

export type PickupPoint = {
  id: string;
  provider: string;
  name: string;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
  timetable: string | null;
  phone: string | null;
  type: "pickup" | "locker" | "post_office" | "terminal";
};

export type ShipmentParty = DeliveryAddress & {
  contactName: string;
  phone: string;
  email?: string | null;
};

export type ShipmentInput = {
  orderNumber: string;
  provider: string;
  tariffId: string;
  method: DeliveryMethod;
  pickupPointId?: string | null;
  sender: ShipmentParty;
  recipient: ShipmentParty;
  package: PackageSpec;
  itemName: string;
  itemCost: number;
  deliveryCost: number;
};

export type ShipmentResult = {
  externalId: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
};

export type ShipmentStatusSnapshot = {
  externalId: string;
  provider: string | null;
  providerNumber: string | null;
  trackingUrl: string | null;
  rawStatus: string;
  status: string | null;
};
