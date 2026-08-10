"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { sellerRequiredDocuments } from "../../lib/legal-documents";

type Seller = { id: number; name: string; inn: string | null; status: string; kycStatus: string; riskScore: number } | null;
type Item = { id: number; productName: string; barcode: string | null; price: number; stock: number; status: string };
type Connection = { id: number; provider: string; accountLabel: string; status: string; lastSyncAt: string | null };
type DemandRequest = { id: number; publicId: string; query: string; barcode: string | null; targetPrice: number | null; city: string | null; quantity: number; expiresAt: string };

export default function SellerDashboard({ email }: { email: string }) {
  const [seller, setSeller] = useState<Seller>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [demandRequests, setDemandRequests] = useState<DemandRequest[]>([]);
  const [demandEligibility, setDemandEligibility] = useState("profile_required");
  const [proposalDrafts, setProposalDrafts] = useState<Record<number, { inventoryItemId: string; price: string; deliveryPrice: string; deliveryDays: string; warrantyMonths: string; comment: string }>>({});
  const [message, setMessage] = useState("Загружаем кабинет…");
  const [storeForm, setStoreForm] = useState({ name: "", inn: "" });
  const [itemForm, setItemForm] = useState({ productName: "", barcode: "", price: "", stock: "1" });
  const [connectionForm, setConnectionForm] = useState({ provider: "ozon", accountLabel: "", login: "", secret: "" });
  const [sellerLegalComplete, setSellerLegalComplete] = useState(false);
  const [sellerChecks, setSellerChecks] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    await fetch("/api/account/bootstrap", { method: "POST" });
    const [profileResponse, legalResponse] = await Promise.all([fetch("/api/sellers/profile"), fetch("/api/legal/acceptances?scope=seller")]);
    if (legalResponse.ok) setSellerLegalComplete(((await legalResponse.json()) as { legal: { complete: boolean } }).legal.complete);
    if (!profileResponse.ok) { setMessage("Кабинет временно недоступен"); return; }
    const profile = await profileResponse.json() as { seller: Seller };
    setSeller(profile.seller);
    if (profile.seller) {
      setStoreForm({ name: profile.seller.name, inn: profile.seller.inn ?? "" });
      const [itemsResponse, connectionsResponse, demandResponse] = await Promise.all([fetch("/api/sellers/inventory"), fetch("/api/sellers/connections"), fetch("/api/sellers/demand")]);
      if (itemsResponse.ok) setItems(((await itemsResponse.json()) as { items: Item[] }).items);
      if (connectionsResponse.ok) setConnections(((await connectionsResponse.json()) as { connections: Connection[] }).connections);
      if (demandResponse.ok) { const demand = await demandResponse.json() as { requests: DemandRequest[]; eligibility: string }; setDemandRequests(demand.requests); setDemandEligibility(demand.eligibility); }
    }
    setMessage("");
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const saveStore = async (event: FormEvent) => {
    event.preventDefault(); setMessage("Сохраняем магазин…");
    const response = await fetch("/api/sellers/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...storeForm, sellerAcceptances: sellerRequiredDocuments.filter((document) => sellerChecks[document.slug]).map((document) => ({ slug: document.slug, version: document.version })) }) });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? "Магазин сохранён и отправлен на проверку" : result.error ?? "Не удалось сохранить магазин");
    if (response.ok) await load();
  };

  const addItem = async (event: FormEvent) => {
    event.preventDefault(); setMessage("Добавляем товар…");
    const response = await fetch("/api/sellers/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...itemForm, price: Number(itemForm.price), stock: Number(itemForm.stock) }) });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? "Товар добавлен" : result.error ?? "Не удалось добавить товар");
    if (response.ok) { setItemForm({ productName: "", barcode: "", price: "", stock: "1" }); await load(); }
  };

  const addConnection = async (event: FormEvent) => {
    event.preventDefault(); setMessage("Шифруем и сохраняем ключи…");
    const credentials = connectionForm.provider === "ozon" ? { clientId: connectionForm.login, apiKey: connectionForm.secret } : connectionForm.provider === "yandex_market" ? { businessId: connectionForm.login, apiKey: connectionForm.secret } : { token: connectionForm.secret };
    const response = await fetch("/api/sellers/connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: connectionForm.provider, accountLabel: connectionForm.accountLabel, credentials }) });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? "Подключение сохранено. Ключи больше не показываются." : result.error ?? "Не удалось сохранить подключение");
    if (response.ok) { setConnectionForm({ provider: "ozon", accountLabel: "", login: "", secret: "" }); await load(); }
  };

  const sendProposal = async (event: FormEvent, requestId: number) => {
    event.preventDefault();
    const draft = proposalDrafts[requestId];
    if (!draft) return;
    setMessage("Отправляем предложение покупателю…");
    const response = await fetch("/api/sellers/demand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, inventoryItemId: Number(draft.inventoryItemId), price: Number(draft.price), deliveryPrice: Number(draft.deliveryPrice || 0), deliveryDays: Number(draft.deliveryDays || 1), warrantyMonths: Number(draft.warrantyMonths || 12), comment: draft.comment }) });
    const result = await response.json() as { error?: string; message?: string };
    setMessage(response.ok ? result.message ?? "Предложение отправлено" : result.error ?? "Не удалось отправить предложение");
    if (response.ok) await load();
  };

  const proposalDraft = (requestId: number) => proposalDrafts[requestId] ?? { inventoryItemId: String(items[0]?.id ?? ""), price: "", deliveryPrice: "0", deliveryDays: "1", warrantyMonths: "12", comment: "" };
  const updateProposal = (requestId: number, patch: Partial<ReturnType<typeof proposalDraft>>) => setProposalDrafts((current) => ({ ...current, [requestId]: { ...proposalDraft(requestId), ...patch } }));
  const allSellerDocumentsChecked = useMemo(() => sellerRequiredDocuments.every((document) => sellerChecks[document.slug]), [sellerChecks]);

  return <main className="portal-page seller-portal">
    <header className="product-bar"><a href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></a><nav><a href="/account">Покупатель</a><a className="active" href="/seller">Продавец</a><a href="/platform">Готовность</a></nav></header>
    <section className="portal-hero"><div className="portal-avatar seller">М</div><div><span className="customer-kicker">Кабинет малого магазина</span><h1>{seller?.name ?? "Подключить магазин"}</h1><p>{email} · получайте спрос и предлагайте цену лучше маркетплейсов</p></div>{seller && <div className="seller-status"><b>{seller.status}</b><span>KYC: {seller.kycStatus}</span></div>}</section>
    {message && <div className="portal-message">{message}</div>}
    <section className="portal-grid">
      <article className="portal-panel seller-profile-panel"><h2>Профиль магазина</h2><form className="portal-form" onSubmit={saveStore}><label>Название<input value={storeForm.name} onChange={(event) => setStoreForm({ ...storeForm, name: event.target.value })} placeholder="ТехноДом" required /></label><label>ИНН<input inputMode="numeric" value={storeForm.inn} onChange={(event) => setStoreForm({ ...storeForm, inn: event.target.value })} placeholder="10 или 12 цифр" /></label>{!sellerLegalComplete && <fieldset className="seller-legal-checks"><legend>Документы продавца</legend><p>Примите каждый документ отдельно. Магазин отвечает за товар, чек, гарантию и возврат.</p>{sellerRequiredDocuments.map((document) => <label key={document.slug}><input type="checkbox" checked={Boolean(sellerChecks[document.slug])} onChange={(event) => setSellerChecks((current) => ({ ...current, [document.slug]: event.target.checked }))} /><span><b>{document.shortTitle}</b><a href={`/legal/${document.slug}`} target="_blank" rel="noreferrer">Версия {document.version} ↗</a></span></label>)}</fieldset>}<button disabled={!sellerLegalComplete && !allSellerDocumentsChecked}>{seller ? "Сохранить изменения" : "Создать магазин"}</button></form>{sellerLegalComplete && <p className="seller-legal-ok">✓ Документы продавца приняты и сохранены</p>}</article>
      <article className="portal-panel"><h2>Проверка и допуск</h2><div className="verification-score"><b>{100 - (seller?.riskScore ?? 0)}</b><span>оценка доверия</span></div><ul className="seller-checklist"><li className={seller?.inn ? "done" : ""}>Реквизиты магазина</li><li className={seller?.kycStatus === "verified" ? "done" : ""}>Проверка владельца и компании</li><li className={seller?.status === "active" ? "done" : ""}>Допуск к безопасным сделкам</li></ul><p className="portal-hint">До проверки можно заполнить ассортимент, но принимать защищённые заказы нельзя.</p></article>
      {seller && <><article className="portal-panel"><h2>Добавить товар</h2><form className="portal-form" onSubmit={addItem}><label>Название<input value={itemForm.productName} onChange={(event) => setItemForm({ ...itemForm, productName: event.target.value })} required /></label><label>Штрих-код<input value={itemForm.barcode} onChange={(event) => setItemForm({ ...itemForm, barcode: event.target.value })} inputMode="numeric" /></label><div className="portal-form-row"><label>Цена<input type="number" min="1" step="0.01" value={itemForm.price} onChange={(event) => setItemForm({ ...itemForm, price: event.target.value })} required /></label><label>Остаток<input type="number" min="0" value={itemForm.stock} onChange={(event) => setItemForm({ ...itemForm, stock: event.target.value })} required /></label></div><button>Добавить в ассортимент</button></form></article>
      <article className="portal-panel"><h2>Подключить площадку</h2><p className="portal-hint">Секреты шифруются на сервере и не возвращаются в интерфейс.</p><form className="portal-form" onSubmit={addConnection}><label>Площадка<select value={connectionForm.provider} onChange={(event) => setConnectionForm({ ...connectionForm, provider: event.target.value })}><option value="ozon">Ozon</option><option value="wildberries">Wildberries</option><option value="yandex_market">Яндекс Маркет</option><option value="custom_feed">Свой фид</option></select></label><label>Название кабинета<input value={connectionForm.accountLabel} onChange={(event) => setConnectionForm({ ...connectionForm, accountLabel: event.target.value })} required /></label>{connectionForm.provider !== "wildberries" && <label>{connectionForm.provider === "ozon" ? "Client ID" : "Business ID"}<input value={connectionForm.login} onChange={(event) => setConnectionForm({ ...connectionForm, login: event.target.value })} required /></label>}<label>Секретный ключ<input type="password" autoComplete="new-password" value={connectionForm.secret} onChange={(event) => setConnectionForm({ ...connectionForm, secret: event.target.value })} required /></label><button>Зашифровать и подключить</button></form></article>
      <article className="portal-panel portal-wide"><div className="portal-panel-title"><div><span className="customer-kicker">Ассортимент</span><h2>Товары магазина</h2></div><b>{items.length}</b></div><div className="inventory-table"><div className="inventory-row head"><span>Товар</span><span>Штрих-код</span><span>Цена</span><span>Остаток</span></div>{items.map((item) => <div className="inventory-row" key={item.id}><b>{item.productName}</b><span>{item.barcode ?? "—"}</span><strong>{item.price.toLocaleString("ru-RU")} ₽</strong><span>{item.stock} шт.</span></div>)}{items.length === 0 && <p>Добавьте первый товар вручную или подключите площадку.</p>}</div></article>
      <article className="portal-panel portal-wide"><div className="portal-panel-title"><div><span className="customer-kicker">Входящий спрос</span><h2>Покупатели ищут эти товары</h2></div><b>{demandRequests.length}</b></div>{demandEligibility !== "eligible" && <p className="portal-warning">Ответы покупателям станут доступны после статуса «active» и успешной проверки KYC. Пока можно видеть подходящий спрос и готовить ассортимент.</p>}<div className="seller-demand-list">{demandRequests.map((requestItem) => { const draft = proposalDraft(requestItem.id); return <form key={requestItem.id} onSubmit={(event) => void sendProposal(event, requestItem.id)}><header><div><small>{requestItem.publicId} · до {new Date(requestItem.expiresAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small><h3>{requestItem.query}</h3><p>{requestItem.city || "Любой город"} · {requestItem.quantity} шт.{requestItem.targetPrice ? ` · покупатель рассчитывает до ${requestItem.targetPrice.toLocaleString("ru-RU")} ₽` : ""}</p></div><span>Новый спрос</span></header><div className="seller-demand-fields"><label>Товар со склада<select value={draft.inventoryItemId} onChange={(event) => updateProposal(requestItem.id, { inventoryItemId: event.target.value })}>{items.map((item) => <option key={item.id} value={item.id}>{item.productName} · {item.stock} шт.</option>)}</select></label><label>Цена<input type="number" min="1" step="0.01" value={draft.price} onChange={(event) => updateProposal(requestItem.id, { price: event.target.value })} required /></label><label>Доставка<input type="number" min="0" step="0.01" value={draft.deliveryPrice} onChange={(event) => updateProposal(requestItem.id, { deliveryPrice: event.target.value })} /></label><label>Срок, дней<input type="number" min="0" max="30" value={draft.deliveryDays} onChange={(event) => updateProposal(requestItem.id, { deliveryDays: event.target.value })} /></label><label>Гарантия, мес.<input type="number" min="0" max="60" value={draft.warrantyMonths} onChange={(event) => updateProposal(requestItem.id, { warrantyMonths: event.target.value })} /></label><label className="wide">Комментарий<input value={draft.comment} onChange={(event) => updateProposal(requestItem.id, { comment: event.target.value })} placeholder="Комплектация, самовывоз или условия" /></label></div><button disabled={demandEligibility !== "eligible" || !items.length}>{demandEligibility === "eligible" ? "Предложить покупателю" : "Ожидается проверка"}</button></form>; })}{demandRequests.length === 0 && <p>Подходящих запросов пока нет. Они появятся автоматически при совпадении модели или штрих-кода с вашим ассортиментом.</p>}</div></article>
      <article className="portal-panel portal-wide"><div className="portal-panel-title"><div><span className="customer-kicker">Интеграции</span><h2>Подключённые кабинеты</h2></div><b>{connections.length}</b></div><div className="connection-grid">{connections.map((connection) => <div key={connection.id}><span>{connection.provider}</span><b>{connection.accountLabel}</b><small>{connection.status} · ключ скрыт</small></div>)}{connections.length === 0 && <p>Подключений пока нет.</p>}</div></article></>}
    </section>
  </main>;
}
