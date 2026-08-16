"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAccessibleDialog } from "../ui/use-accessible-dialog";

type PlannerOrder = { id: number; publicId: string; productName: string; itemAmount: number; deliveryAmount: number; amount: number; isDemo: boolean };
type Address = { id: number; label: string; recipientName: string; phone: string; countryCode: string; postalCode: string | null; region: string | null; city: string; addressLine: string; apartment: string | null; entrance: string | null; floor: string | null; comment: string | null; isDefault: boolean };
type Rate = { publicId: string; provider: string; providerLabel: string; serviceName: string; method: "courier" | "pickup" | "seller" | "self_pickup"; amount: number; daysMin: number; daysMax: number; isDemo: boolean };
type Point = { id: string; provider: string; name: string; address: string; city: string; timetable: string | null; type: string };

const emptyAddress = { label: "Дом", recipientName: "", phone: "", countryCode: "RU", postalCode: "", region: "", city: "", addressLine: "", apartment: "", entrance: "", floor: "", comment: "", isDefault: true };

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value);
}

function dateRange(daysMin: number, daysMax: number) {
  if (daysMin === 0 && daysMax === 0) return "сегодня";
  if (daysMin === daysMax) return `${daysMin} дн.`;
  return `${daysMin}–${daysMax} дн.`;
}

export default function DeliveryPlanner({ order, initialName, onClose, onSaved }: { order: PlannerOrder; initialName: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialogRef = useAccessibleDialog(true, onClose);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<number | null>(null);
  const [addressForm, setAddressForm] = useState({ ...emptyAddress, recipientName: initialName });
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [rates, setRates] = useState<Rate[]>([]);
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [pointId, setPointId] = useState("");
  const [stage, setStage] = useState<"address" | "rates" | "point" | "confirm" | "done">("address");
  const [message, setMessage] = useState("Загружаем сохранённые адреса…");
  const [busy, setBusy] = useState(false);
  const [externalNetwork, setExternalNetwork] = useState(false);

  const loadAddresses = useCallback(async () => {
    const response = await fetch("/api/delivery/addresses", { cache: "no-store" });
    if (!response.ok) { setMessage("Не удалось загрузить адреса"); return; }
    const payload = await response.json() as { addresses: Address[] };
    setAddresses(payload.addresses);
    const primary = payload.addresses.find((address) => address.isDefault) ?? payload.addresses[0];
    setAddressId(primary?.id ?? null);
    setShowAddressForm(payload.addresses.length === 0);
    setMessage("");
  }, []);

  useEffect(() => { void Promise.resolve().then(loadAddresses); }, [loadAddresses]);

  const saveAddress = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("Сохраняем адрес…");
    const response = await fetch("/api/delivery/addresses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(addressForm) });
    const payload = await response.json() as { address?: Address; error?: string };
    if (!response.ok || !payload.address) { setMessage(payload.error ?? "Не удалось сохранить адрес"); setBusy(false); return; }
    await loadAddresses();
    setAddressId(payload.address.id);
    setShowAddressForm(false);
    setMessage("Адрес сохранён");
    setBusy(false);
  };

  const calculate = async () => {
    if (!addressId) { setShowAddressForm(true); setMessage("Сначала добавьте адрес"); return; }
    setBusy(true); setMessage("Сравниваем цену и срок у служб доставки…");
    const response = await fetch("/api/delivery/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: order.id, addressId }) });
    const payload = await response.json() as { rates?: Rate[]; error?: string; externalNetwork?: boolean; providerWarning?: string | null };
    if (!response.ok || !payload.rates) { setMessage(payload.error ?? "Не удалось рассчитать доставку"); setBusy(false); return; }
    setRates(payload.rates);
    setExternalNetwork(Boolean(payload.externalNetwork));
    setStage("rates");
    setMessage(payload.providerWarning || (payload.externalNetwork ? "Показываем итоговую стоимость — без скрытых доплат." : "Доступна доставка продавца. Внешняя сеть появится после подключения логистики."));
    setBusy(false);
  };

  const chooseRate = async (rate: Rate) => {
    setSelectedRate(rate); setPointId(""); setPoints([]);
    if (rate.method !== "pickup") { setStage("confirm"); return; }
    setBusy(true); setMessage("Ищем удобные пункты выдачи…");
    const response = await fetch("/api/delivery/pickup-points", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotePublicId: rate.publicId, addressId }) });
    const payload = await response.json() as { points?: Point[]; error?: string };
    if (!response.ok || !payload.points?.length) { setMessage(payload.error ?? "ПВЗ не найдены — выберите другой тариф"); setBusy(false); return; }
    setPoints(payload.points); setStage("point"); setMessage("Выберите пункт, который удобнее по адресу и графику."); setBusy(false);
  };

  const confirm = async () => {
    if (!selectedRate || !addressId || (selectedRate.method === "pickup" && !pointId)) return;
    setBusy(true); setMessage("Закрепляем цену и способ доставки…");
    const response = await fetch("/api/delivery/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotePublicId: selectedRate.publicId, addressId, pickupPointId: pointId }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setMessage(payload.error ?? "Не удалось сохранить доставку"); setBusy(false); return; }
    await onSaved(); setStage("done"); setMessage(""); setBusy(false);
  };

  const activeAddress = addresses.find((address) => address.id === addressId) ?? null;
  const activePoint = points.find((point) => point.id === pointId) ?? null;
  const fastest = useMemo(() => rates.reduce<Rate | null>((best, rate) => !best || rate.daysMax < best.daysMax ? rate : best, null), [rates]);

  return <div className="delivery-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} className="delivery-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-title" tabIndex={-1}>
      <header><div><span className="customer-kicker">Заказ {order.publicId}</span><h2 id="delivery-title">Доставка без лишних шагов</h2><p>{order.productName}</p></div><button onClick={onClose} aria-label="Закрыть">×</button></header>
      <div className="delivery-progress" aria-label="Этап оформления"><span className="done">1<b>Адрес</b></span><i /><span className={stage !== "address" ? "done" : ""}>2<b>Способ</b></span><i /><span className={["confirm", "done"].includes(stage) ? "done" : ""}>3<b>Проверка</b></span></div>
      {message && <p className="delivery-message" role="status">{busy && <span className="delivery-spinner" />}{message}</p>}

      {stage === "address" && <div className="delivery-address-stage">
        {addresses.length > 0 && <div className="delivery-address-list">{addresses.map((address) => <label key={address.id} className={addressId === address.id ? "active" : ""}><input type="radio" name="address" checked={addressId === address.id} onChange={() => setAddressId(address.id)} /><span><b>{address.label} · {address.recipientName}</b><small>{address.city}, {address.addressLine}{address.apartment ? `, кв. ${address.apartment}` : ""}</small><em>{address.phone}</em></span></label>)}</div>}
        <button className="delivery-text-button" onClick={() => setShowAddressForm((value) => !value)}>{showAddressForm ? "Скрыть форму" : "+ Добавить другой адрес"}</button>
        {showAddressForm && <form className="delivery-address-form" onSubmit={saveAddress}><div className="delivery-form-row"><label>Получатель<input value={addressForm.recipientName} onChange={(event) => setAddressForm({ ...addressForm, recipientName: event.target.value })} required /></label><label>Телефон<input type="tel" value={addressForm.phone} onChange={(event) => setAddressForm({ ...addressForm, phone: event.target.value })} placeholder="+7 900 000-00-00" required /></label></div><div className="delivery-form-row"><label>Город<input value={addressForm.city} onChange={(event) => setAddressForm({ ...addressForm, city: event.target.value })} required /></label><label>Индекс<input inputMode="numeric" value={addressForm.postalCode} onChange={(event) => setAddressForm({ ...addressForm, postalCode: event.target.value })} /></label></div><label>Улица, дом, корпус<input value={addressForm.addressLine} onChange={(event) => setAddressForm({ ...addressForm, addressLine: event.target.value })} required /></label><div className="delivery-form-row three"><label>Квартира<input value={addressForm.apartment} onChange={(event) => setAddressForm({ ...addressForm, apartment: event.target.value })} /></label><label>Подъезд<input value={addressForm.entrance} onChange={(event) => setAddressForm({ ...addressForm, entrance: event.target.value })} /></label><label>Этаж<input value={addressForm.floor} onChange={(event) => setAddressForm({ ...addressForm, floor: event.target.value })} /></label></div><label>Комментарий курьеру<input value={addressForm.comment} onChange={(event) => setAddressForm({ ...addressForm, comment: event.target.value })} placeholder="Домофон, ориентир или удобное время" /></label><button disabled={busy}>Сохранить адрес</button></form>}
        <button className="delivery-primary" disabled={busy || !addressId} onClick={() => void calculate()}>Показать варианты доставки</button>
      </div>}

      {stage === "rates" && <div className="delivery-rates-stage"><div className="delivery-stage-title"><div><h3>Выберите лучшее для себя</h3><p>{activeAddress?.city}, {activeAddress?.addressLine}</p></div><button onClick={() => setStage("address")}>Изменить адрес</button></div><div className="delivery-rate-list">{rates.map((rate, index) => <button key={rate.publicId} onClick={() => void chooseRate(rate)}><span className={`delivery-provider provider-${rate.provider.slice(0, 8)}`}>{rate.providerLabel.slice(0, 1)}</span><span><b>{rate.providerLabel}</b><small>{rate.serviceName} · {rate.method === "pickup" ? "ПВЗ/постамат" : rate.method === "seller" ? "курьер магазина" : "до двери"}</small></span><span className="delivery-rate-badges">{index === 0 && <em>Выгоднее</em>}{fastest?.publicId === rate.publicId && index !== 0 && <em className="fast">Быстрее</em>}</span><strong>{money(rate.amount)}<small>{dateRange(rate.daysMin, rate.daysMax)}</small></strong><i>›</i></button>)}</div>{!externalNetwork && !order.isDemo && <p className="delivery-network-note">Сейчас показана доставка магазина. После подключения логистического кабинета здесь автоматически появятся СДЭК, 5Post, DPD и другие перевозчики.</p>}</div>}

      {stage === "point" && selectedRate && <div className="delivery-point-stage"><div className="delivery-stage-title"><div><h3>Пункт выдачи {selectedRate.providerLabel}</h3><p>{selectedRate.serviceName} · {money(selectedRate.amount)}</p></div><button onClick={() => setStage("rates")}>Другой способ</button></div><div className="delivery-point-list">{points.map((point) => <label key={point.id} className={pointId === point.id ? "active" : ""}><input type="radio" name="pickup-point" checked={pointId === point.id} onChange={() => setPointId(point.id)} /><span className="delivery-point-icon">{point.type === "locker" ? "▦" : "⌖"}</span><span><b>{point.name}</b><small>{point.address}</small><em>{point.timetable || "График уточняется"}</em></span></label>)}</div><button className="delivery-primary" disabled={!pointId} onClick={() => setStage("confirm")}>Выбрать этот пункт</button></div>}

      {stage === "confirm" && selectedRate && <div className="delivery-confirm-stage"><div className="delivery-confirm-check">✓</div><h3>Всё готово к оформлению</h3><p>Проверьте итог до оплаты. Изменить способ можно, пока заказ не оплачен.</p><dl><div><dt>Товар</dt><dd>{money(order.itemAmount)}</dd></div><div><dt>Доставка</dt><dd>{money(selectedRate.amount)}</dd></div><div><dt>Способ</dt><dd>{selectedRate.providerLabel} · {selectedRate.serviceName}</dd></div><div><dt>Получение</dt><dd>{activePoint?.address || `${activeAddress?.city}, ${activeAddress?.addressLine}`}</dd></div><div className="total"><dt>Итого к оплате</dt><dd>{money(order.itemAmount + selectedRate.amount)}</dd></div></dl><div className="delivery-confirm-actions"><button onClick={() => setStage(selectedRate.method === "pickup" ? "point" : "rates")}>Назад</button><button disabled={busy} onClick={() => void confirm()}>Подтвердить доставку</button></div></div>}

      {stage === "done" && <div className="delivery-done"><span>✓</span><h3>Доставка выбрана</h3><p>Цена добавлена к заказу. После оплаты продавец передаст отправление перевозчику, а трек появится в кабинете.</p><button onClick={onClose}>Вернуться к покупкам</button></div>}
    </section>
  </div>;
}
