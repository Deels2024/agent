"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { TRANSACTION_CONFIRMATION_VERSION } from "../../lib/legal-documents";
import { useAccessibleDialog } from "../ui/use-accessible-dialog";
import { useHashSection } from "../ui/use-hash-section";
import DeliveryPlanner from "./delivery-planner";

type AccountSection = "overview" | "requests" | "orders" | "prices" | "marketplaces" | "notifications" | "plus" | "profile";
type Order = { id: number; publicId: string; productName: string; sellerName?: string | null; provider: string; itemAmount: number; deliveryAmount: number; amount: number; isDemo: boolean; status: string; paymentStatus: string; deliveryStatus: string; createdAt: string };
type Alert = { id: number; query: string; targetPrice: number; currentPrice: number | null; status: string; channel: string };
type Notice = { id: number; template: string; status: string; readAt?: string | null; createdAt: string; payload?: Record<string, unknown> };
type Subscription = { plan: string; status: string; currentPeriodEnd: string | null } | null;
type DemandRequest = { id: number; publicId: string; query: string; targetPrice: number | null; city: string | null; quantity: number; status: string; createdAt: string };
type Proposal = { id: number; requestId: number; sellerName: string; price: number; deliveryPrice: number; deliveryDays: number; warrantyMonths: number; comment: string | null; status: string };
type LegalStatus = { complete: boolean; accepted: Array<{ slug: string; version: string; status: string; acceptedAt: string; revokedAt: string | null }> } | null;
type BuyerMarketplaceConnection = { id: number; provider: string; accountLabel: string; status: string; authMethod: string; scopes: string[]; itemCount: number; consentedAt: string | null; lastSyncAt: string | null; updatedAt: string };
type BuyerMarketplaceItem = { id: number; provider: string; sourceList: string; externalId: string; productName: string; productUrl: string; createdAt: string; updatedAt: string };

const navigation: Array<{ id: AccountSection; label: string; icon: string }> = [
  { id: "overview", label: "Главная", icon: "⌂" },
  { id: "requests", label: "Предложения магазинов", icon: "◇" },
  { id: "orders", label: "Мои покупки", icon: "▣" },
  { id: "prices", label: "Контроль цен", icon: "⌁" },
  { id: "marketplaces", label: "Мои магазины", icon: "◎" },
  { id: "notifications", label: "Уведомления", icon: "◉" },
  { id: "plus", label: "Подписка Plus", icon: "✦" },
  { id: "profile", label: "Профиль и защита", icon: "○" },
];
const accountSectionIds = navigation.map((item) => item.id);

const statusLabels: Record<string, string> = {
  created: "Создан", awaiting_payment: "Ожидает оплаты", paid: "Оплачен", processing: "Собирается", delivered: "Получен", disputed: "Открыт спор", refunded: "Возвращён",
  not_started: "Не начато", pending: "В процессе", succeeded: "Оплачено", sandbox: "Тест", in_transit: "В пути", active: "Активно", triggered: "Цель достигнута", cancelled: "Отключено",
  selected: "Способ выбран", accepted: "Принято перевозчиком", ready_for_pickup: "Можно забирать", sandbox_created: "Тестовое отправление", lost: "Требует проверки", problem: "Нужна помощь с доставкой",
  login_opened: "Ozon открыт", link_import_ready: "Ссылки добавлены",
};

const noticeLabels: Record<string, { title: string; icon: string }> = {
  welcome: { title: "Добро пожаловать в Агент покупок", icon: "✦" },
  price_alert_created: { title: "Контроль цены включён", icon: "⌁" },
  price_target_reached: { title: "Цена достигла вашей цели", icon: "↓" },
  order_created: { title: "Заявка на покупку создана", icon: "▣" },
  plus_trial_started: { title: "Пробный период Plus активирован", icon: "✦" },
  dispute_opened: { title: "Обращение принято", icon: "!" },
  delivery_status_changed: { title: "Изменился статус доставки", icon: "▤" },
  delivery_selected: { title: "Способ доставки выбран", icon: "⌖" },
  delivery_created: { title: "Отправление передано в доставку", icon: "▤" },
  demo_order_created: { title: "Тестовая заявка создана", icon: "◇" },
  seller_proposal_received: { title: "Магазин предложил свою цену", icon: "↓" },
  proposal_accepted: { title: "Покупатель принял предложение", icon: "✓" },
  new_demand_request: { title: "Новый подходящий спрос", icon: "⌁" },
  verify_email: { title: "Подтверждение email отправлено", icon: "✓" },
  password_reset: { title: "Запрошено восстановление пароля", icon: "↻" },
};

function money(value: number) { return `${value.toLocaleString("ru-RU")} ₽`; }
function humanStatus(value: string) { return statusLabels[value] ?? value.replaceAll("_", " "); }

export default function AccountDashboard({ initialName, initialEmail, initialIsAdmin, logoutHref, authProvider, initialEmailVerified }: { initialName: string; initialEmail: string; initialIsAdmin: boolean; logoutHref: string; authProvider: "chatgpt" | "standalone"; initialEmailVerified: boolean }) {
  const [section, setSection] = useHashSection<AccountSection>("overview", accountSectionIds);
  const [orders, setOrders] = useState<Order[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [plusConfigured, setPlusConfigured] = useState(false);
  const [demandRequests, setDemandRequests] = useState<DemandRequest[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [message, setMessage] = useState("Загружаем данные…");
  const [loading, setLoading] = useState(true);
  const [alertForm, setAlertForm] = useState({ query: "", targetPrice: "", channel: "in_app" });
  const [pendingProposal, setPendingProposal] = useState<Proposal | null>(null);
  const [proposalConfirmed, setProposalConfirmed] = useState(false);
  const [legalStatus, setLegalStatus] = useState<LegalStatus>(null);
  const [deliveryOrder, setDeliveryOrder] = useState<Order | null>(null);
  const [marketplaceConnection, setMarketplaceConnection] = useState<BuyerMarketplaceConnection | null>(null);
  const [marketplaceItems, setMarketplaceItems] = useState<BuyerMarketplaceItem[]>([]);
  const [ozonConsent, setOzonConsent] = useState(false);
  const [ozonLink, setOzonLink] = useState("");
  const [marketplaceBusy, setMarketplaceBusy] = useState(false);
  const closeProposalDialog = useCallback(() => { setPendingProposal(null); setProposalConfirmed(false); }, []);
  const proposalDialogRef = useAccessibleDialog(Boolean(pendingProposal), closeProposalDialog);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bootstrap = await fetch("/api/account/bootstrap", { method: "POST" });
      if (!bootstrap.ok) {
        const result = await bootstrap.json() as { error?: string };
        setMessage(result.error ?? "Не удалось загрузить профиль. Обновите страницу."); return;
      }
      const bootstrapData = await bootstrap.json() as { legal?: LegalStatus };
      if (bootstrapData.legal) setLegalStatus(bootstrapData.legal);
      await fetch("/api/account/preference", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ portal: "buyer" }) }).catch(() => null);
      const [ordersResponse, alertsResponse, noticesResponse, subscriptionResponse, demandResponse, marketplaceResponse, healthResponse] = await Promise.all([fetch("/api/orders"), fetch("/api/price-alerts"), fetch("/api/notifications"), fetch("/api/subscriptions"), fetch("/api/demand-requests"), fetch("/api/account/marketplaces"), fetch("/api/health")]);
      if (ordersResponse.ok) setOrders(((await ordersResponse.json()) as { orders: Order[] }).orders);
      if (alertsResponse.ok) setAlerts(((await alertsResponse.json()) as { alerts: Alert[] }).alerts);
      if (noticesResponse.ok) setNotices(((await noticesResponse.json()) as { notifications: Notice[] }).notifications);
      if (subscriptionResponse.ok) setSubscription(((await subscriptionResponse.json()) as { subscription: Subscription }).subscription);
      if (demandResponse.ok) { const demand = await demandResponse.json() as { requests: DemandRequest[]; proposals: Proposal[] }; setDemandRequests(demand.requests); setProposals(demand.proposals); }
      if (marketplaceResponse.ok) { const marketplace = await marketplaceResponse.json() as { connections: BuyerMarketplaceConnection[]; items: BuyerMarketplaceItem[] }; setMarketplaceConnection(marketplace.connections.find((item) => item.provider === "ozon") ?? null); setMarketplaceItems(marketplace.items.filter((item) => item.provider === "ozon")); }
      if (healthResponse.ok) setPlusConfigured(Boolean(((await healthResponse.json()) as { capabilities?: { paymentGateway?: boolean } }).capabilities?.paymentGateway));
      const failed = [ordersResponse, alertsResponse, noticesResponse, subscriptionResponse, demandResponse, marketplaceResponse].some((response) => !response.ok);
      setMessage(failed ? "Часть данных временно недоступна. Остальные разделы можно использовать." : "");
    } catch {
      setMessage("Нет связи с сервером. Проверьте интернет и нажмите «Повторить».");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const activeAlerts = useMemo(() => alerts.filter((item) => item.status === "active"), [alerts]);
  const unreadNotices = useMemo(() => notices.filter((item) => !item.readAt).length, [notices]);
  const plusActive = subscription?.plan === "plus" && ["trial", "active"].includes(subscription.status);

  const createAlert = async (event: FormEvent) => {
    event.preventDefault(); setMessage("Сохраняем правило цены…");
    try {
      const response = await fetch("/api/price-alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...alertForm, targetPrice: Number(alertForm.targetPrice) }) });
      const result = await response.json() as { error?: string };
      setMessage(response.ok ? "Готово — агент начал следить за ценой" : result.error ?? "Не удалось создать правило");
      if (response.ok) { setAlertForm({ query: "", targetPrice: "", channel: "in_app" }); await load(); }
    } catch { setMessage("Нет связи с сервером. Правило не сохранено — повторите действие."); }
  };

  const cancelAlert = async (id: number) => {
    setMessage("Отключаем контроль цены…");
    try {
      const response = await fetch(`/api/price-alerts?id=${id}`, { method: "DELETE" });
      setMessage(response.ok ? "Контроль цены отключён" : "Не удалось отключить правило");
      if (response.ok) await load();
    } catch { setMessage("Нет связи с сервером. Правило осталось активным."); }
  };

  const startTrial = async () => {
    if (!plusConfigured) { setMessage("Plus пока не подключается: сначала нужен платёжный партнёр. Списаний не будет."); return; }
    setMessage("Подключаем бесплатный период…");
    try {
      const response = await fetch("/api/subscriptions", { method: "POST" });
      const result = await response.json() as { error?: string; warning?: string };
      setMessage(response.ok ? result.warning ?? "Plus подключён" : result.error ?? "Не удалось подключить Plus");
      if (response.ok) await load();
    } catch { setMessage("Нет связи с сервером. Подписка не изменилась."); }
  };

  const revokeMarketing = async () => {
    setMessage("Отключаем рекламные сообщения…");
    try {
      const response = await fetch("/api/legal/acceptances", { method: "DELETE" });
      setMessage(response.ok ? "Рекламные сообщения отключены. Сервисные уведомления о заказах останутся." : "Не удалось изменить согласие");
      if (response.ok) await load();
    } catch { setMessage("Нет связи с сервером. Настройка согласия не изменилась."); }
  };

  const resendVerification = async () => {
    setMessage("Отправляем новое письмо…");
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST" });
      const result = await response.json() as { error?: string; queued?: boolean };
      setMessage(response.ok ? result.queued ? "Письмо подтверждения поставлено в очередь" : "Email уже подтверждён" : result.error ?? "Не удалось отправить письмо");
    } catch { setMessage("Нет связи с сервером. Письмо не отправлено."); }
  };

  const markNotificationsRead = async () => {
    try {
      const response = await fetch("/api/notifications", { method: "PATCH" });
      if (response.ok) setNotices((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } catch { setMessage("Не удалось обновить уведомления. Повторите позже."); }
  };

  const acceptProposal = async (proposalId: number) => {
    if (!proposalConfirmed) { setMessage("Подтвердите продавца и условия конкретной сделки"); return; }
    setMessage("Фиксируем предложение магазина…");
    try {
      const quoteResponse = await fetch("/api/demand-requests", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId }) });
      const quote = await quoteResponse.json() as { quoteId?: string; error?: string };
      if (!quoteResponse.ok || !quote.quoteId) { setMessage(quote.error ?? "Не удалось принять предложение"); return; }
      const orderResponse = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: quote.quoteId, termsAccepted: true, sellerRoleAccepted: true, transactionConfirmationVersion: TRANSACTION_CONFIRMATION_VERSION }) });
      const order = await orderResponse.json() as { error?: string };
      setMessage(orderResponse.ok ? "Предложение принято и защищённая заявка создана. Деньги пока не списывались." : order.error ?? "Не удалось создать заявку");
      if (orderResponse.ok) { setPendingProposal(null); setProposalConfirmed(false); await load(); setSection("orders"); }
    } catch { setMessage("Нет связи с сервером. Предложение не принято и деньги не списаны."); }
  };

  const openOzonAccount = async () => {
    if (!ozonConsent) { setMessage("Подтвердите безопасные условия перед открытием Ozon"); return; }
    window.open("https://www.ozon.ru/my/main", "_blank", "noopener,noreferrer");
    setMarketplaceBusy(true); setMessage("Открываем официальный Ozon…");
    try {
      const response = await fetch("/api/account/marketplaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", termsAccepted: true }) });
      const result = await response.json() as { connection?: BuyerMarketplaceConnection; error?: string; message?: string };
      setMessage(response.ok ? result.message ?? "Ozon открыт в новой вкладке" : result.error ?? "Не удалось сохранить действие");
      if (response.ok && result.connection) setMarketplaceConnection(result.connection);
    } catch { setMessage("Ozon можно использовать в новой вкладке, но статус кабинета пока не сохранился."); }
    finally { setMarketplaceBusy(false); }
  };

  const importOzonLink = async (event: FormEvent) => {
    event.preventDefault(); setMarketplaceBusy(true); setMessage("Добавляем товар из Ozon…");
    try {
      const response = await fetch("/api/account/marketplaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "import_link", url: ozonLink }) });
      const result = await response.json() as { error?: string; message?: string };
      setMessage(response.ok ? result.message ?? "Товар добавлен" : result.error ?? "Не удалось добавить товар");
      if (response.ok) { setOzonLink(""); await load(); }
    } catch { setMessage("Нет связи с сервером. Ссылка не сохранена — повторите действие."); }
    finally { setMarketplaceBusy(false); }
  };

  const disconnectOzon = async () => {
    if (!window.confirm("Удалить импортированные ссылки Ozon из Агент покупок? Аккаунт и товары в самом Ozon не изменятся.")) return;
    setMarketplaceBusy(true); setMessage("Удаляем подключение Ozon…");
    try {
      const response = await fetch("/api/account/marketplaces", { method: "DELETE" });
      const result = await response.json() as { error?: string };
      setMessage(response.ok ? "Ozon отключён. Сохранённые ссылки удалены из сервиса." : result.error ?? "Не удалось отключить Ozon");
      if (response.ok) { setMarketplaceConnection(null); setMarketplaceItems([]); setOzonConsent(false); }
    } catch { setMessage("Нет связи с сервером. Подключение не изменилось."); }
    finally { setMarketplaceBusy(false); }
  };

  const userInitial = initialName.slice(0, 1).toUpperCase();

  return <main className="account-app">
    <aside className="account-sidebar">
      <a className="account-logo" href="/"><span>✦</span><div><b>Агент покупок</b><small>Личный кабинет</small></div></a>
      <div className="account-user-mini"><span>{userInitial}</span><div><b>{initialName}</b><small>{initialEmail}</small></div></div>
      <nav aria-label="Разделы личного кабинета">{navigation.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><span>{item.icon}</span>{item.label}{item.id === "notifications" && unreadNotices > 0 && <em>{Math.min(unreadNotices, 9)}</em>}</button>)}</nav>
      <div className="account-sidebar-links">{initialIsAdmin && <a href="/admin"><span>⚙</span>Админ-панель</a>}<a href="/seller"><span>◇</span>Переключиться на продавца</a><a href="/live-search"><span>⌕</span>Вернуться к поиску</a></div>
      <a className="account-logout" href={logoutHref}><span>↪</span><div><b>Выйти</b><small>Завершить сеанс</small></div></a>
    </aside>

    <section className="account-main">
      <header className="account-topbar"><div><span>Личный кабинет</span><b>{navigation.find((item) => item.id === section)?.label}</b></div><div><a href="#marketplaces">◎ Мои магазины</a><a href="/live-search">⌕ Найти товар</a><button onClick={() => setSection("profile")}><span>{userInitial}</span><div><b>{initialName}</b><small>{plusActive ? "Plus активен" : "Базовый тариф"}</small></div></button></div></header>
      <nav className="account-mobile-nav" aria-label="Мобильные разделы">{navigation.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>
      {message && <div className="account-toast"><span>{loading ? "◌" : "i"}</span><p>{message}</p>{message.includes("Нет связи") || message.includes("недоступна") ? <button className="account-retry" onClick={() => void load()}>Повторить</button> : null}<button onClick={() => setMessage("")} aria-label="Закрыть">×</button></div>}

      <div className="account-content">
        {section === "overview" && <>
          <section className="account-welcome"><div><span>Добро пожаловать, {initialName.split(" ")[0]}</span><h1>Все покупки и выгода — под контролем</h1><p>Агент следит за ценами, сохраняет историю и помогает после покупки.</p><a href="/live-search">Найти лучшее предложение →</a></div><div className="account-welcome-score"><b>{activeAlerts.length + orders.length}</b><span>задач контролирует агент</span><small>Система работает штатно</small></div></section>
          <section className="account-metrics"><article><span className="blue">▣</span><div><small>Покупки</small><b>{orders.length}</b><p>{orders.filter((item) => !["delivered", "refunded"].includes(item.status)).length} активных</p></div></article><article><span className="green">⌁</span><div><small>Контроль цен</small><b>{activeAlerts.length}</b><p>{alerts.filter((item) => item.status === "triggered").length} целей достигнуто</p></div></article><article><span className="orange">◉</span><div><small>Уведомления</small><b>{notices.length}</b><p>вся история сохранена</p></div></article><article><span className="violet">✦</span><div><small>Подписка</small><b>{plusActive ? "Plus" : "Free"}</b><p>{plusActive ? "преимущества активны" : plusConfigured ? "можно попробовать" : "готовим запуск"}</p></div></article></section>
          <section className="account-overview-grid"><article className="account-card account-recent"><div className="account-card-title"><div><small>Последние покупки</small><h2>Заказы и заявки</h2></div><button onClick={() => setSection("orders")}>Все покупки</button></div>{orders.length === 0 ? <Empty icon="▣" title="Покупок пока нет" text="Найдите товар, сравните предложения и создайте первую защищённую заявку." action="Перейти к поиску" href="/live-search" /> : <div className="account-order-list">{orders.slice(0, 4).map((order) => <OrderRow key={order.id} order={order} />)}</div>}</article>
          <article className="account-card"><div className="account-card-title"><div><small>Безопасное оформление</small><h2>Новая заявка</h2></div></div><p className="account-muted">Цена больше не вводится вручную. Сначала агент фиксирует конкретное предложение, наличие и доставку, затем создаёт заявку.</p><div className="account-safe-actions"><a href="/live-search">⌕ Найти и зафиксировать предложение</a><a className="secondary" href="#marketplaces">◎ Добавить товар из моего Ozon</a><a className="secondary" href="/live-search#merchant-demand">◇ Запросить цену у малых магазинов</a></div><small className="account-form-note">Это защищает от подмены суммы и случайной покупки другой модификации товара.</small></article></section>
        </>}

        {section === "requests" && <section className="account-section"><div className="account-section-head"><div><span>Прямые предложения</span><h1>Цены малых магазинов</h1><p>Проверенные продавцы отвечают на ваш запрос своей итоговой ценой, доставкой и гарантией.</p></div><a href="/live-search#merchant-demand">+ Новый запрос</a></div><div className="account-demand-list">{demandRequests.map((requestItem) => <article className="account-card" key={requestItem.id}><header><div><small>{requestItem.publicId} · {new Date(requestItem.createdAt).toLocaleDateString("ru-RU")}</small><h2>{requestItem.query}</h2><p>{requestItem.city || "Любой город"} · {requestItem.quantity} шт.{requestItem.targetPrice ? ` · цель ${money(requestItem.targetPrice)}` : ""}</p></div><span className={`account-status ${requestItem.status}`}>{humanStatus(requestItem.status)}</span></header><div className="account-proposal-list">{proposals.filter((item) => item.requestId === requestItem.id).map((proposal) => <div key={proposal.id}><div><b>{proposal.sellerName}</b><small>Доставка {proposal.deliveryDays === 0 ? "сегодня" : `${proposal.deliveryDays} дн.`} · гарантия {proposal.warrantyMonths} мес.</small>{proposal.comment && <p>{proposal.comment}</p>}</div><strong>{money(proposal.price + proposal.deliveryPrice)}</strong><button disabled={requestItem.status !== "open" || proposal.status !== "active"} onClick={() => { setPendingProposal(proposal); setProposalConfirmed(false); }}>{proposal.status === "accepted" ? "Принято" : "Выбрать"}</button></div>)}{proposals.filter((item) => item.requestId === requestItem.id).length === 0 && <p>Запрос уже видят подходящие магазины. Сообщим, когда появится ответ.</p>}</div></article>)}{demandRequests.length === 0 && <div className="account-card"><Empty icon="◇" title="Запросов магазинам пока нет" text="Найдите товар и попросите малые магазины предложить свою цену." action="Начать поиск" href="/live-search" /></div>}</div></section>}

        {section === "orders" && <section className="account-section"><div className="account-section-head"><div><span>История покупок</span><h1>Мои покупки</h1><p>Оплата, доставка, чек, возврат и помощь находятся в одном месте.</p></div><a href="/live-search">+ Найти товар</a></div>{orders.length === 0 ? <div className="account-card"><Empty icon="▣" title="У вас ещё нет покупок" text="Агент поможет найти лучшее предложение и проверить продавца." action="Начать поиск" href="/live-search" /></div> : <div className="account-order-grid">{orders.map((order) => <article key={order.id} className={`account-order-card ${order.isDemo ? "demo" : ""}`}><div className="account-order-card-head"><span className={`account-status ${order.status}`}>{order.isDemo ? "Демо · без оплаты" : humanStatus(order.status)}</span><small>{new Date(order.createdAt).toLocaleDateString("ru-RU")}</small></div><div className="account-product-placeholder">▣</div><h2>{order.productName}</h2><p>{order.sellerName || order.provider} · {order.publicId}</p><b>{money(order.amount)}</b><div className="account-order-facts"><span><small>Оплата</small><b>{order.isDemo ? "Не требуется" : humanStatus(order.paymentStatus)}</b></span><span><small>Доставка</small><b>{humanStatus(order.deliveryStatus)}</b></span></div>{["not_started", "selected"].includes(order.deliveryStatus) && (order.isDemo || order.paymentStatus === "not_started") && <button className="account-delivery-button" onClick={() => setDeliveryOrder(order)}><span>⌖</span><div><b>{order.deliveryStatus === "selected" ? "Изменить доставку" : "Выбрать доставку"}</b><small>Сравнить цену, срок и ПВЗ</small></div><em>›</em></button>}<div className="account-order-actions"><a href="/legal/safe-deal-rules#section-7">Возврат и защита</a><button onClick={() => setSection("notifications")}>Получить помощь</button></div></article>)}</div>}</section>}

        {section === "prices" && <section className="account-section"><div className="account-section-head"><div><span>Персональный мониторинг</span><h1>Контроль цен</h1><p>Уведомим только о реальном снижении итоговой цены, без ложных скидок.</p></div></div><div className="account-prices-layout"><article className="account-card"><h2>Добавить товар</h2><form className="account-form" onSubmit={createAlert}><label>Название или модель<input value={alertForm.query} onChange={(event) => setAlertForm({ ...alertForm, query: event.target.value })} placeholder="Например, Roborock Q8 Max" required /></label><label>Целевая цена<input type="number" min="1" step="0.01" value={alertForm.targetPrice} onChange={(event) => setAlertForm({ ...alertForm, targetPrice: event.target.value })} placeholder="35 000 ₽" required /></label><label>Куда сообщить<select value={alertForm.channel} onChange={(event) => setAlertForm({ ...alertForm, channel: event.target.value })}><option value="in_app">В личном кабинете</option><option value="email">На email</option><option value="sms">По SMS</option><option value="push">Push-уведомлением</option></select></label><button>Начать следить</button></form><p className="account-form-note">Частота проверки и доступные каналы зависят от подключённых интеграций.</p></article><article className="account-card account-watch-list"><div className="account-card-title"><div><small>Ваши правила</small><h2>{activeAlerts.length} активно</h2></div></div>{alerts.length === 0 ? <Empty icon="⌁" title="Правил пока нет" text="Добавьте товар и укажите цену, при которой его стоит покупать." /> : alerts.map((alert) => <div className="account-watch-row" key={alert.id}><span>⌁</span><div><b>{alert.query}</b><small>Цель: {money(alert.targetPrice)} · {humanStatus(alert.status)}</small></div><strong>{alert.currentPrice ? money(alert.currentPrice) : "Проверяем"}</strong>{alert.status === "active" && <button onClick={() => void cancelAlert(alert.id)}>Отключить</button>}</div>)}</article></div></section>}

        {section === "marketplaces" && <section className="account-section">
          <div className="account-section-head"><div><span>Товары из ваших магазинов</span><h1>Мои магазины</h1><p>Откройте свой Ozon и передайте агенту товары, которые нужно найти дешевле или у более надёжного продавца.</p></div></div>
          <section className="account-marketplace-hero">
            <div className="account-marketplace-brand"><span>O</span><div><small>Раздел доступен сейчас</small><h2>Ozon</h2><p>Открывайте товары в своём аккаунте и передавайте ссылки агенту для сравнения.</p></div></div>
            <div className="account-marketplace-state"><span className={`account-status ${marketplaceConnection?.status ?? "pending"}`}>{marketplaceConnection ? humanStatus(marketplaceConnection.status) : "Не подключён"}</span><b>{marketplaceItems.length} товаров</b><small>{marketplaceConnection?.lastSyncAt ? `Обновлено ${new Date(marketplaceConnection.lastSyncAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Ссылки ещё не добавлены"}</small></div>
          </section>
          <div className="account-marketplace-grid">
            <article className="account-card account-marketplace-connect">
              <div className="account-card-title"><div><small>Шаг 1</small><h2>Откройте свой Ozon</h2></div><span className="account-trust-badge">✓ Без пароля</span></div>
              <p className="account-muted">Мы откроем Ozon в новой вкладке. Войдите там как обычно — Агент покупок не видит и не хранит ваш пароль, SMS‑код или cookies.</p>
              <ol><li><span>1</span><div><b>Откройте официальный Ozon</b><small>Адрес начинается с www.ozon.ru</small></div></li><li><span>2</span><div><b>Войдите в аккаунт на стороне Ozon</b><small>Личные данные остаются у площадки</small></div></li><li><span>3</span><div><b>Откройте нужный товар и скопируйте ссылку</b><small>Добавьте её в форму справа</small></div></li></ol>
              <label className="account-marketplace-consent"><input type="checkbox" checked={ozonConsent} onChange={(event) => setOzonConsent(event.target.checked)} /><span>Понимаю: сейчас сервис получает только ссылки, которые я передам сам. Доступ к корзине и избранному потребует отдельного официального разрешения Ozon.</span></label>
              <button className="account-primary-button" disabled={!ozonConsent || marketplaceBusy} onClick={() => void openOzonAccount()}>{marketplaceBusy ? "Подождите…" : "Открыть мой Ozon ↗"}</button>
            </article>
            <article className="account-card account-marketplace-import">
              <div className="account-card-title"><div><small>Шаг 2</small><h2>Добавьте товар</h2></div><span className="account-trust-badge blue">Сразу работает</span></div>
              <p className="account-muted">Скопируйте ссылку из карточки Ozon. Агент сохранит товар и предложит сравнить его с маркетплейсами и малыми магазинами.</p>
              <form className="account-form" onSubmit={importOzonLink}><label>Ссылка на товар Ozon<input type="url" inputMode="url" value={ozonLink} onChange={(event) => setOzonLink(event.target.value)} placeholder="https://www.ozon.ru/product/…" required /></label><button disabled={marketplaceBusy || !ozonLink.trim()}>Добавить и найти выгоднее</button></form>
              <div className="account-marketplace-auto"><span>↻</span><div><b>Автосинхронизация корзины и избранного</b><small>Интерфейс и база готовы. Включим после получения официального партнёрского доступа Ozon — без обхода защиты площадки.</small></div><em>Готовится</em></div>
            </article>
          </div>
          <article className="account-card account-marketplace-items">
            <div className="account-card-title"><div><small>Передано агенту</small><h2>Товары из Ozon</h2></div>{marketplaceConnection && <button disabled={marketplaceBusy} onClick={() => void disconnectOzon()}>Отключить и удалить</button>}</div>
            {marketplaceItems.length === 0 ? <Empty icon="◎" title="Список пока пуст" text="Откройте товар в Ozon, скопируйте ссылку и добавьте её выше. Корзина в Ozon при этом не изменится." /> : <div className="account-marketplace-item-list">{marketplaceItems.map((item) => <div key={item.id}><span>O</span><div><b>{item.productName}</b><small>Артикул: {item.externalId} · добавлен {new Date(item.createdAt).toLocaleDateString("ru-RU")}</small></div><a href={item.productUrl} target="_blank" rel="noreferrer">В Ozon ↗</a><a className="primary" href={`/live-search?q=${encodeURIComponent(item.productName)}`}>Сравнить цены</a></div>)}</div>}
          </article>
          <div className="account-marketplace-privacy"><span>⌾</span><div><b>Вы управляете данными</b><p>Отключение удаляет импортированные ссылки из Агент покупок и не меняет аккаунт, корзину или заказы в Ozon. Для будущей автоматической синхронизации потребуется новое отдельное согласие.</p></div><a href="/legal/privacy-policy">Как защищаем данные →</a></div>
        </section>}

        {section === "notifications" && <section className="account-section"><div className="account-section-head"><div><span>Центр событий</span><h1>Уведомления</h1><p>Изменения цен, заказов, доставки и обращения агента.</p></div>{unreadNotices > 0 && <button onClick={() => void markNotificationsRead()}>Отметить прочитанными</button>}</div><article className="account-card account-notifications">{notices.length === 0 ? <Empty icon="◉" title="Новых событий нет" text="Когда что-то изменится, агент сообщит здесь." /> : notices.map((notice) => { const meta = noticeLabels[notice.template] ?? { title: humanStatus(notice.template), icon: "◉" }; return <div className={notice.readAt ? "read" : "unread"} key={notice.id}><span>{meta.icon}</span><div><b>{meta.title}</b><p>{notice.status === "sent" ? "Доставлено" : "Сохранено в центре уведомлений"}</p></div><time>{new Date(notice.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div>; })}</article></section>}

        {section === "plus" && <section className="account-section"><div className="account-section-head"><div><span>Подписка</span><h1>Агент покупок Plus</h1><p>Больше контроля, персональные задания и приоритетная помощь.</p></div></div><section className="account-plus-hero"><div><span>PLUS ✦</span><h2>{plusActive ? "Ваши преимущества активны" : plusConfigured ? "Покупайте спокойнее и выгоднее" : "Готовим честный запуск Plus"}</h2><p>{plusActive ? `Текущий статус: ${humanStatus(subscription?.status ?? "active")}${subscription?.currentPeriodEnd ? ` · до ${new Date(subscription.currentPeriodEnd).toLocaleDateString("ru-RU")}` : ""}.` : plusConfigured ? "7 дней бесплатно. Автоматическое списание не включается без отдельного подтверждения." : "Подписка станет доступна после подключения платёжного партнёра. Сейчас оформить её или случайно списать деньги невозможно."}</p>{!plusActive && plusConfigured && <button onClick={startTrial}>Попробовать бесплатно</button>}</div><div className="account-plus-saving"><small>Подтверждённая выгода</small><b>0 ₽</b><p>Начнём считать после первой реальной покупки</p></div></section><div className="account-benefits"><article><span>⌁</span><h3>Больше правил цены</h3><p>Следите за нужными моделями и получайте сигнал в подходящий момент.</p></article><article><span>✦</span><h3>Приоритет агенту</h3><p>Сложные задания и запросы малым магазинам обрабатываются быстрее.</p></article><article><span>◇</span><h3>Расширенная защита</h3><p>Помощь с возвратом, спором и документами по покупке.</p></article></div></section>}

        {section === "profile" && <section className="account-section"><div className="account-section-head"><div><span>Аккаунт</span><h1>Профиль и безопасность</h1><p>Личные данные, защита входа и управление сеансом.</p></div></div><div className="account-profile-grid"><article className="account-card"><div className="account-profile-person"><span>{userInitial}</span><div><h2>{initialName}</h2><p>{initialEmail}</p><em className={initialEmailVerified ? "" : "pending"}>{initialEmailVerified ? "Email подтверждён" : "Email ожидает подтверждения"}</em></div></div>{authProvider === "standalone" && !initialEmailVerified && <button className="account-secondary-button" onClick={() => void resendVerification()}>Отправить письмо повторно</button>}<div className="account-info-row"><span>Способ входа</span><b>{authProvider === "standalone" ? "Email и защищённый пароль" : "ChatGPT / защищённый вход"}</b></div><div className="account-info-row"><span>Тариф</span><b>{plusActive ? "Plus" : "Базовый"}</b></div><div className="account-info-row"><span>Роль</span><b>{initialIsAdmin ? "Администратор и покупатель" : "Покупатель"}</b></div></article><article className="account-card account-security"><div className="account-card-title"><div><small>Безопасность</small><h2>Текущий сеанс</h2></div><span>Защищён</span></div><p>{authProvider === "standalone" ? "Сервис хранит только стойкий хеш пароля. Сессионный ключ защищён HttpOnly cookie." : "Вход подтверждён платформой ChatGPT. Сервис не получает и не хранит ваш пароль."}</p><div className="account-session"><span>◉</span><div><b>Текущий браузер</b><small>Активен сейчас</small></div><em>Это вы</em></div><a className="account-danger-link" href={logoutHref}>↪ Выйти из аккаунта на этом устройстве</a></article><article className="account-card"><h2>Данные и документы</h2><p className="account-muted">{legalStatus?.complete ? `Принято актуальных документов: ${legalStatus.accepted.filter((item) => item.status === "accepted").length}` : "Проверяем версии документов…"}</p><div className="account-settings-links"><a href="/legal/privacy-policy"><span>▤</span><div><b>Конфиденциальность</b><small>Данные, сроки и получатели</small></div><em>›</em></a><a href="/legal/buyer-agency-offer"><span>◇</span><div><b>Агентская оферта</b><small>Продавец отвечает за товар и чек</small></div><em>›</em></a><a href="/legal#consents"><span>✓</span><div><b>Все принятые документы</b><small>Версии и порядок фиксации</small></div><em>›</em></a></div>{legalStatus?.accepted.some((item) => item.slug === "marketing-consent" && item.status === "accepted") && <button className="account-secondary-button" onClick={() => void revokeMarketing()}>Отключить рекламные сообщения</button>}</article><article className="account-card account-support"><span>?</span><div><h2>Нужна помощь?</h2><p>Обращения по покупке и возврату сохраняются в истории.</p></div><button onClick={() => setSection("notifications")}>Открыть центр помощи</button></article></div></section>}
      </div>
    </section>
    {pendingProposal && <div className="transaction-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeProposalDialog(); }}><section ref={proposalDialogRef} className="transaction-modal" role="dialog" aria-modal="true" aria-labelledby="proposal-dialog-title" aria-describedby="proposal-dialog-note" tabIndex={-1}><header><div><span className="customer-kicker">Предложение малого магазина</span><h2 id="proposal-dialog-title">Подтвердите условия покупки</h2></div><button onClick={closeProposalDialog} aria-label="Закрыть окно">×</button></header><div className="transaction-product"><span>◇</span><div><b>{demandRequests.find((item) => item.id === pendingProposal.requestId)?.query ?? "Товар по вашему запросу"}</b><small>Продавец: {pendingProposal.sellerName}</small></div></div><dl><div><dt>Цена товара</dt><dd>{money(pendingProposal.price)}</dd></div><div><dt>Доставка</dt><dd>{money(pendingProposal.deliveryPrice)}</dd></div><div><dt>Гарантия</dt><dd>{pendingProposal.warrantyMonths} мес.</dd></div><div className="total"><dt>Итого</dt><dd>{money(pendingProposal.price + pendingProposal.deliveryPrice)}</dd></div></dl><div className="transaction-roles"><p><span>Продавец</span><b>{pendingProposal.sellerName} продаёт товар, выдаёт чек и отвечает за возврат</b></p><p><span>Агент</span><b>Фиксирует предложение и передаёт ваше поручение</b></p></div><label className="transaction-confirm"><input type="checkbox" checked={proposalConfirmed} onChange={(event) => setProposalConfirmed(event.target.checked)} /><span>Подтверждаю продавца и итоговую сумму. Принимаю <a href="/legal/buyer-agency-offer" target="_blank">агентскую оферту</a> и <a href="/legal/safe-deal-rules" target="_blank">правила безопасной сделки</a>.</span></label><button className="transaction-submit" disabled={!proposalConfirmed} onClick={() => void acceptProposal(pendingProposal.id)}>Подтвердить предложение</button><small id="proposal-dialog-note">Деньги на этом шаге не списываются. Для закрытия можно нажать Esc.</small></section></div>}
    {deliveryOrder && <DeliveryPlanner order={deliveryOrder} initialName={initialName} onClose={() => setDeliveryOrder(null)} onSaved={load} />}
  </main>;
}

function OrderRow({ order }: { order: Order }) {
  return <div className="account-order-row"><span>▣</span><div><b>{order.productName}</b><small>{order.publicId} · {new Date(order.createdAt).toLocaleDateString("ru-RU")}</small></div><strong>{money(order.amount)}</strong><em>{humanStatus(order.status)}</em></div>;
}

function Empty({ icon, title, text, action, href }: { icon: string; title: string; text: string; action?: string; href?: string }) {
  return <div className="account-empty"><span>{icon}</span><h3>{title}</h3><p>{text}</p>{action && href && <a href={href}>{action}</a>}</div>;
}
