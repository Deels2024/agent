"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type DeliveryProfile = { contactName: string; phone: string; countryCode: string; postalCode: string | null; region: string | null; city: string; addressLine: string; comment: string | null } | null;
type DeliveryConnection = { id: number; provider: string; accountLabel: string; status: string; lastCheckedAt: string | null };
type NetworkItem = { key: string; label: string; modes: string[] };
type SellerOrder = {
  id: number;
  publicId: string;
  productName: string;
  amount: number;
  paymentStatus: string;
  deliveryStatus: string;
  isDemo: boolean;
  deliveryId: number | null;
  deliveryProvider: string | null;
  deliveryMethod: string | null;
  deliveryServiceName: string | null;
  pickupPointJson: string | null;
  recipientJson: string | null;
  trackingNumber: string | null;
};

const emptyProfile = { contactName: "", phone: "", countryCode: "RU", postalCode: "", region: "", city: "", addressLine: "", comment: "" };

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value);
}

function safeJson(value: string | null) {
  try { return JSON.parse(value ?? "{}") as Record<string, unknown>; } catch { return {}; }
}

export default function SellerDeliveryPanel({ sellerName, onMessage }: { sellerName: string; onMessage: (message: string) => void }) {
  const [profile, setProfile] = useState(emptyProfile);
  const [connections, setConnections] = useState<DeliveryConnection[]>([]);
  const [network, setNetwork] = useState<NetworkItem[]>([]);
  const [platformConfigured, setPlatformConfigured] = useState(false);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [connectionForm, setConnectionForm] = useState({ accountLabel: "Основная логистика", apiToken: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [settingsResponse, ordersResponse] = await Promise.all([fetch("/api/sellers/delivery", { cache: "no-store" }), fetch("/api/sellers/orders", { cache: "no-store" })]);
    if (settingsResponse.ok) {
      const payload = await settingsResponse.json() as { profile: DeliveryProfile; connections: DeliveryConnection[]; network: NetworkItem[]; platformConfigured: boolean };
      setConnections(payload.connections);
      setNetwork(payload.network);
      setPlatformConfigured(payload.platformConfigured);
      if (payload.profile) setProfile({ contactName: payload.profile.contactName, phone: payload.profile.phone, countryCode: payload.profile.countryCode, postalCode: payload.profile.postalCode ?? "", region: payload.profile.region ?? "", city: payload.profile.city, addressLine: payload.profile.addressLine, comment: payload.profile.comment ?? "" });
      else setProfile((current) => ({ ...current, contactName: current.contactName || sellerName }));
    }
    if (ordersResponse.ok) setOrders(((await ordersResponse.json()) as { orders: SellerOrder[] }).orders);
  }, [sellerName]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); onMessage("Сохраняем адрес отгрузки…");
    const response = await fetch("/api/sellers/delivery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
    const payload = await response.json() as { error?: string };
    onMessage(response.ok ? "Адрес отгрузки сохранён" : payload.error ?? "Не удалось сохранить адрес");
    if (response.ok) await load();
    setBusy(false);
  };

  const saveConnection = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); onMessage("Защищаем ключ доставки…");
    const response = await fetch("/api/sellers/delivery/connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "apiship", ...connectionForm }) });
    const payload = await response.json() as { error?: string; message?: string };
    onMessage(response.ok ? payload.message ?? "Доставка подключена" : payload.error ?? "Не удалось подключить доставку");
    if (response.ok) { setConnectionForm({ ...connectionForm, apiToken: "" }); await load(); }
    setBusy(false);
  };

  const removeConnection = async (id: number) => {
    setBusy(true);
    const response = await fetch(`/api/sellers/delivery/connections?id=${id}`, { method: "DELETE" });
    const payload = await response.json() as { error?: string };
    onMessage(response.ok ? "Личное подключение отключено" : payload.error ?? "Не удалось отключить");
    if (response.ok) await load();
    setBusy(false);
  };

  const createShipment = async (orderId: number) => {
    setBusy(true); onMessage("Передаём заказ в доставку…");
    const response = await fetch("/api/deliveries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId }) });
    const payload = await response.json() as { error?: string };
    onMessage(response.ok ? "Отправление создано, покупатель получит уведомление" : payload.error ?? "Не удалось создать отправление");
    if (response.ok) await load();
    setBusy(false);
  };

  const readyOrders = useMemo(() => orders.filter((order) => order.deliveryStatus !== "delivered"), [orders]);
  const hasConnection = connections.some((connection) => connection.provider === "apiship") || platformConfigured;

  return <article id="seller-delivery" className="portal-panel portal-wide seller-delivery-panel">
    <header className="seller-delivery-head">
      <div><span className="customer-kicker">Логистика без ручной рутины</span><h2>Доставка заказов</h2><p>Один расчёт сравнивает службы, показывает ПВЗ и передаёт выбранный вариант в заказ.</p></div>
      <div className={hasConnection ? "ready" : "attention"}><b>{hasConnection ? "Сеть подключена" : "Нужно подключение"}</b><small>{hasConnection ? "Доставка продавца также доступна" : "Резерв — свой курьер"}</small></div>
    </header>

    <div className="seller-delivery-layout">
      <form className="portal-form seller-dispatch-form" onSubmit={saveProfile}>
        <div><span>1</span><h3>Откуда забирать товар</h3><p>Адрес видит только логистика и покупатель после оформления.</p></div>
        <div className="portal-form-row"><label>Контактное лицо<input value={profile.contactName} onChange={(event) => setProfile({ ...profile, contactName: event.target.value })} required /></label><label>Телефон<input type="tel" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="+7 900 000-00-00" required /></label></div>
        <div className="portal-form-row"><label>Город<input value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} required /></label><label>Индекс<input inputMode="numeric" value={profile.postalCode} onChange={(event) => setProfile({ ...profile, postalCode: event.target.value })} /></label></div>
        <label>Регион<input value={profile.region} onChange={(event) => setProfile({ ...profile, region: event.target.value })} placeholder="Москва или Ленинградская область" /></label>
        <label>Адрес склада / магазина<input value={profile.addressLine} onChange={(event) => setProfile({ ...profile, addressLine: event.target.value })} placeholder="Улица, дом, строение" required /></label>
        <label>Комментарий курьеру<input value={profile.comment} onChange={(event) => setProfile({ ...profile, comment: event.target.value })} placeholder="Вход, время работы, пропуск" /></label>
        <button disabled={busy}>Сохранить адрес отгрузки</button>
      </form>

      <section className="seller-delivery-connect">
        <div><span>2</span><h3>Подключить службы доставки</h3><p>ApiShip объединяет десятки перевозчиков в одном API. Токен хранится только в зашифрованном виде.</p></div>
        {connections.map((connection) => <div className="seller-delivery-connection" key={connection.id}><span>✓</span><div><b>{connection.accountLabel}</b><small>ApiShip · ключ скрыт · {connection.status}</small></div><button disabled={busy} onClick={() => void removeConnection(connection.id)}>Отключить</button></div>)}
        {!connections.length && <form className="portal-form" onSubmit={saveConnection}><label>Название подключения<input value={connectionForm.accountLabel} onChange={(event) => setConnectionForm({ ...connectionForm, accountLabel: event.target.value })} required /></label><label>API-токен ApiShip<input type="password" autoComplete="new-password" value={connectionForm.apiToken} onChange={(event) => setConnectionForm({ ...connectionForm, apiToken: event.target.value })} placeholder="Вставьте токен из личного кабинета" required /></label><button disabled={busy}>Зашифровать и подключить</button><small>Ключ не показывается повторно и не попадает в браузер после сохранения.</small></form>}
        <div className="seller-carrier-cloud">{network.map((item) => <span key={item.key}><b>{item.label}</b><small>{item.modes.join(" · ")}</small></span>)}</div>
      </section>
    </div>

    <section className="seller-shipment-queue">
      <header><div><span>3</span><h3>Заказы к отправке</h3></div><b>{readyOrders.length}</b></header>
      {readyOrders.map((order) => {
        const recipient = safeJson(order.recipientJson);
        const point = safeJson(order.pickupPointJson);
        const paid = order.isDemo || ["succeeded", "paid"].includes(order.paymentStatus);
        const selected = order.deliveryStatus === "selected";
        return <article key={order.id}><div className="seller-shipment-product"><small>{order.publicId}</small><b>{order.productName}</b><span>{money(order.amount)}</span></div><div><small>Получатель</small><b>{String(recipient.recipientName ?? "Ожидаем выбор покупателя")}</b><span>{String(point.address ?? recipient.addressLine ?? "Адрес ещё не выбран")}</span></div><div><small>Доставка</small><b>{order.deliveryServiceName || "Не выбрана"}</b><span>{order.trackingNumber ? `Трек: ${order.trackingNumber}` : order.deliveryProvider || "—"}</span></div><button disabled={busy || !selected || !paid} onClick={() => void createShipment(order.id)}>{!selected ? "Ждём выбор доставки" : !paid ? "Ждём оплату" : "Создать отправление"}</button></article>;
      })}
      {!readyOrders.length && <p className="seller-shipment-empty">Новые оплаченные заказы появятся здесь. Агент уже сохранит адрес, тариф и выбранный ПВЗ.</p>}
    </section>
  </article>;
}
