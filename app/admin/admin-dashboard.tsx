"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccessibleDialog } from "../ui/use-accessible-dialog";
import { useHashSection } from "../ui/use-hash-section";

type AdminSection = "overview" | "users" | "sellers" | "orders" | "disputes" | "risk" | "system" | "audit";
type Metrics = { users: number; sellers: number; orders: number; openDemand: number; openDisputes: number; elevatedRisks: number; failedNotifications: number };
type Module = { id: number; title: string; description: string; status: string; missing: string[]; route?: string };
type Seller = { id: number; ownerEmail: string; name: string; inn: string | null; status: string; kycStatus: string; riskScore: number; createdAt: string };
type User = { id: number; email: string; display_name: string | null; role: string; status: string; created_at: string };
type Order = { id: number; public_id: string; buyer_email: string; product_name: string; amount: number; status: string; payment_status: string; delivery_status: string; created_at: string };
type Dispute = { id: number; order_id: number; opened_by_email: string; reason: string; status: string; resolution: string | null; created_at: string };
type Risk = { id: number; actor_email: string | null; event_type: string; score: number; status: string; created_at: string };
type Audit = { id: number; actor_email: string | null; action: string; entity_type: string; entity_id: string | null; created_at: string };

const nav: Array<{ id: AdminSection; label: string; icon: string }> = [
  { id: "overview", label: "Обзор", icon: "⌂" },
  { id: "users", label: "Пользователи", icon: "◎" },
  { id: "sellers", label: "Продавцы", icon: "◇" },
  { id: "orders", label: "Заказы", icon: "▣" },
  { id: "disputes", label: "Споры", icon: "!" },
  { id: "risk", label: "Риски", icon: "△" },
  { id: "system", label: "Система", icon: "◫" },
  { id: "audit", label: "Аудит", icon: "≡" },
];
const adminSectionIds = nav.map((item) => item.id);
type PendingResolution = { item: Dispute; status: "resolved" | "rejected" | "closed" };

const labels: Record<string, string> = {
  active: "Активен", suspended: "Приостановлен", draft: "Черновик", review: "На проверке", rejected: "Отклонён",
  not_started: "Не начато", pending: "В процессе", verified: "Проверен", created: "Создан", awaiting_payment: "Ожидает оплаты",
  paid: "Оплачен", processing: "Собирается", delivered: "Доставлен", disputed: "Открыт спор", refunded: "Возвращён", cancelled: "Отменён",
  succeeded: "Оплачено", sandbox: "Тест", open: "Открыт", resolved: "Решён", closed: "Закрыт", ignored: "Пропущен",
  ready: "Готов", needs_configuration: "Нужна настройка", external_contract: "Нужен партнёр",
};

function human(value: string) { return labels[value] ?? value.replaceAll("_", " "); }
function date(value: string) { return new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function money(value: number) { return `${value.toLocaleString("ru-RU")} ₽`; }
const orderTransitions: Record<string, string[]> = { created: ["cancelled"], awaiting_payment: ["cancelled"], paid: ["processing", "disputed", "refunded"], processing: ["delivered", "disputed", "refunded", "cancelled"], delivered: ["disputed", "refunded"], disputed: ["processing", "delivered", "refunded", "cancelled"], refunded: [], cancelled: [] };

export default function AdminDashboard({ initialName, initialEmail, logoutHref }: { initialName: string; initialEmail: string; logoutHref: string }) {
  const [section, setSection] = useHashSection<AdminSection>("overview", adminSectionIds);
  const [metrics, setMetrics] = useState<Metrics>({ users: 0, sellers: 0, orders: 0, openDemand: 0, openDisputes: 0, elevatedRisks: 0, failedNotifications: 0 });
  const [modules, setModules] = useState<Module[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [notice, setNotice] = useState("Загружаем панель управления…");
  const [busy, setBusy] = useState(false);
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [resolutionError, setResolutionError] = useState("");
  const closeResolutionDialog = useCallback(() => { if (!busy) { setPendingResolution(null); setResolutionText(""); setResolutionError(""); } }, [busy]);
  const resolutionDialogRef = useAccessibleDialog(Boolean(pendingResolution), closeResolutionDialog);

  const load = useCallback(async () => {
    const [overviewResponse, sellersResponse, operationsResponse] = await Promise.all([
      fetch("/api/admin/overview"), fetch("/api/admin/sellers"), fetch("/api/admin/operations"),
    ]);
    if ([overviewResponse, sellersResponse, operationsResponse].some((response) => response.status === 403)) {
      setNotice("Доступ администратора отозван. Выйдите и войдите снова."); return;
    }
    if (!overviewResponse.ok || !sellersResponse.ok || !operationsResponse.ok) {
      setNotice("Не удалось загрузить часть данных. Проверьте подключение базы и обновите страницу."); return;
    }
    const overview = await overviewResponse.json() as { metrics: Metrics; platform: { modules: Module[] } };
    const sellerData = await sellersResponse.json() as { sellers: Seller[] };
    const operations = await operationsResponse.json() as { users: User[]; orders: Order[]; disputes: Dispute[]; risks: Risk[]; audits: Audit[] };
    setMetrics(overview.metrics); setModules(overview.platform.modules); setSellers(sellerData.sellers);
    setUsers(operations.users); setOrders(operations.orders); setDisputes(operations.disputes); setRisks(operations.risks); setAudits(operations.audits);
    setNotice("");
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const runOperation = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true); setNotice("Сохраняем изменение…");
    try {
      const response = await fetch("/api/admin/operations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      setNotice(response.ok ? success : result.error ?? "Не удалось сохранить изменение");
      if (response.ok) await load();
      return response.ok;
    } catch {
      setNotice("Нет связи с сервером. Проверьте интернет и повторите действие.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reviewSeller = async (seller: Seller, status: string, kycStatus: string) => {
    setBusy(true); setNotice("Сохраняем решение по продавцу…");
    const response = await fetch("/api/admin/sellers", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sellerId: seller.id, status, kycStatus, riskScore: seller.riskScore, comment: "Решение из веб-админки" }) });
    const result = await response.json() as { error?: string };
    setNotice(response.ok ? "Статус продавца обновлён" : result.error ?? "Не удалось обновить продавца");
    if (response.ok) await load();
    setBusy(false);
  };

  const openResolutionDialog = (item: Dispute, status: PendingResolution["status"]) => {
    setPendingResolution({ item, status });
    setResolutionText(item.resolution ?? "");
    setResolutionError("");
  };

  const saveResolution = async () => {
    if (!pendingResolution) return;
    const resolution = resolutionText.trim();
    if (resolution.length < 10) { setResolutionError("Опишите решение минимум в 10 символах, чтобы оно было понятно покупателю."); return; }
    const saved = await runOperation({ action: "dispute_resolution", targetId: pendingResolution.item.id, status: pendingResolution.status, resolution }, "Решение по спору сохранено");
    if (saved) { setPendingResolution(null); setResolutionText(""); setResolutionError(""); }
  };

  const activeModules = useMemo(() => modules.filter((item) => item.status === "ready").length, [modules]);
  const currentTitle = nav.find((item) => item.id === section)?.label ?? "Обзор";
  const userInitial = initialName.slice(0, 1).toUpperCase();

  return <main className="admin-app">
    <aside className="admin-sidebar">
      <a className="admin-logo" href="/"><span>✦</span><div><b>Агент покупок</b><small>Управление сервисом</small></div></a>
      <div className="admin-environment"><span></span><div><b>Production</b><small>Защищённая зона</small></div></div>
      <nav aria-label="Разделы админ-панели">{nav.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><span>{item.icon}</span>{item.label}{item.id === "disputes" && metrics.openDisputes > 0 && <em>{metrics.openDisputes}</em>}{item.id === "risk" && metrics.elevatedRisks > 0 && <em>{metrics.elevatedRisks}</em>}</button>)}</nav>
      <div className="admin-sidebar-foot"><a href="/account">← Личный кабинет</a><a href="/platform">Состояние платформы</a><a className="admin-logout" href={logoutHref}>↪ Выйти из системы</a></div>
    </aside>

    <section className="admin-main">
      <header className="admin-topbar"><div><small>Администрирование</small><b>{currentTitle}</b></div><div><a href="/">Открыть сервис ↗</a><button onClick={() => setSection("audit")}><span>{userInitial}</span><div><b>{initialName}</b><small>Администратор</small></div></button></div></header>
      <nav className="admin-mobile-nav" aria-label="Мобильные разделы">{nav.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>
      {notice && <div className="admin-notice"><span>{busy ? "◌" : "i"}</span><p>{notice}</p><button onClick={() => setNotice("")} aria-label="Закрыть">×</button></div>}

      <div className="admin-content">
        {section === "overview" && <>
          <div className="admin-heading"><div><span>Сегодня</span><h1>Сервис под контролем</h1><p>Ключевые операции, обращения и риски в одном рабочем пространстве.</p></div><button onClick={() => void load()}>↻ Обновить данные</button></div>
          <section className="admin-metrics"><Metric icon="◎" title="Пользователи" value={metrics.users} hint={`${users.filter((item) => item.status === "active").length} активных`} tone="blue" /><Metric icon="◇" title="Продавцы" value={metrics.sellers} hint={`${metrics.openDemand} открытых запросов покупателей`} tone="violet" /><Metric icon="▣" title="Заказы" value={metrics.orders} hint={`${orders.filter((item) => !["delivered", "refunded", "cancelled"].includes(item.status)).length} в работе`} tone="green" /><Metric icon="!" title="Требуют внимания" value={metrics.openDisputes + metrics.elevatedRisks} hint={`${metrics.openDisputes} споров · ${metrics.elevatedRisks} рисков`} tone="orange" /></section>
          <section className="admin-overview-grid"><article className="admin-card"><div className="admin-card-title"><div><small>Операционный центр</small><h2>Очередь внимания</h2></div></div><QueueRow icon="!" title="Открытые споры" value={metrics.openDisputes} action="Открыть" onClick={() => setSection("disputes")} /><QueueRow icon="△" title="Повышенный риск" value={metrics.elevatedRisks} action="Проверить" onClick={() => setSection("risk")} /><QueueRow icon="◇" title="Проверка продавцов" value={sellers.filter((item) => item.status === "review").length} action="Перейти" onClick={() => setSection("sellers")} /><QueueRow icon="◉" title="Ошибки уведомлений" value={metrics.failedNotifications} action="Система" onClick={() => setSection("system")} /></article><article className="admin-card admin-readiness"><div className="admin-readiness-score"><b>{activeModules}<small>/{modules.length || 15}</small></b><span>модулей готовы</span></div><div><small>Готовность платформы</small><h2>Запуск контролируется честно</h2><p>Внешние партнёры и отсутствующие ключи не маскируются демо-данными.</p><button onClick={() => setSection("system")}>Проверить все модули</button></div></article></section>
        </>}

        {section === "users" && <AdminList title="Пользователи" eyebrow="Доступ и статусы" description="Блокировка ограничивает операции сервиса, но не изменяет список администраторов."><div className="admin-table"><div className="admin-table-row admin-table-head users"><span>Пользователь</span><span>Роль</span><span>Регистрация</span><span>Статус</span><span>Действие</span></div>{users.length === 0 ? <Empty text="Пользователей пока нет" /> : users.map((item) => <div className="admin-table-row users" key={item.id}><div><b>{item.display_name || item.email.split("@")[0]}</b><small>{item.email}</small></div><span>{human(item.role)}</span><span>{date(item.created_at)}</span><Status value={item.status} /><button disabled={busy || item.email.toLowerCase() === initialEmail.toLowerCase()} onClick={() => void runOperation({ action: "user_status", targetId: item.id, status: item.status === "active" ? "suspended" : "active" }, item.status === "active" ? "Пользователь приостановлен" : "Пользователь активирован")}>{item.email.toLowerCase() === initialEmail.toLowerCase() ? "Ваш аккаунт" : item.status === "active" ? "Приостановить" : "Активировать"}</button></div>)}</div></AdminList>}

        {section === "sellers" && <AdminList title="Продавцы" eyebrow="Проверка поставщиков" description="Допуск, KYC и риск-оценка каждого малого магазина."><div className="admin-seller-grid">{sellers.length === 0 ? <Empty text="Заявок продавцов пока нет" /> : sellers.map((seller) => <article className="admin-seller-card" key={seller.id}><div className="admin-seller-head"><span>◇</span><div><h2>{seller.name}</h2><p>{seller.ownerEmail}</p></div><Status value={seller.status} /></div><dl><div><dt>ИНН</dt><dd>{seller.inn || "Не указан"}</dd></div><div><dt>KYC</dt><dd>{human(seller.kycStatus)}</dd></div><div><dt>Риск</dt><dd className={seller.riskScore >= 40 ? "high" : "low"}>{seller.riskScore}/100</dd></div><div><dt>Создан</dt><dd>{date(seller.createdAt)}</dd></div></dl><div className="admin-seller-actions"><button disabled={busy} onClick={() => void reviewSeller(seller, "active", "verified")}>✓ Одобрить</button><button disabled={busy} onClick={() => void reviewSeller(seller, "review", "pending")}>⌁ На проверку</button><button className="danger" disabled={busy} onClick={() => void reviewSeller(seller, "suspended", seller.kycStatus)}>Приостановить</button></div></article>)}</div></AdminList>}

        {section === "orders" && <AdminList title="Заказы" eyebrow="Сделки и исполнение" description="Итоговая цена, оплата, доставка и только допустимые следующие этапы заказа."><div className="admin-order-list">{orders.length === 0 ? <Empty text="Заказов пока нет" /> : orders.map((order) => <article key={order.id}><div><Status value={order.status} /><small>{date(order.created_at)}</small></div><section><span>▣</span><div><h2>{order.product_name}</h2><p>{order.public_id} · {order.buyer_email}</p></div><b>{money(order.amount)}</b></section><footer><span>Оплата: <b>{human(order.payment_status)}</b></span><span>Доставка: <b>{human(order.delivery_status)}</b></span><label>Следующий этап<select value={order.status} disabled={busy || !(orderTransitions[order.status]?.length)} onChange={(event) => void runOperation({ action: "order_status", targetId: order.id, status: event.target.value }, "Статус заказа обновлён")}><option value={order.status}>{human(order.status)}</option>{(orderTransitions[order.status] ?? []).map((status) => <option key={status} value={status}>{human(status)}</option>)}</select></label></footer></article>)}</div></AdminList>}

        {section === "disputes" && <AdminList title="Споры" eyebrow="Защита покупателя" description="Рассматривайте причины, фиксируйте решение и сохраняйте прозрачный журнал."><div className="admin-case-list">{disputes.length === 0 ? <Empty text="Открытых и завершённых споров нет" /> : disputes.map((item) => <article key={item.id}><header><div><span>Спор #{item.id}</span><h2>Заказ #{item.order_id}</h2></div><Status value={item.status} /></header><p>{item.reason}</p><small>{item.opened_by_email} · {date(item.created_at)}</small>{item.resolution && <blockquote>{item.resolution}</blockquote>}{item.status === "open" && <footer><button disabled={busy} onClick={() => openResolutionDialog(item, "resolved")}>Решить</button><button disabled={busy} onClick={() => openResolutionDialog(item, "rejected")}>Отклонить</button><button className="neutral" disabled={busy} onClick={() => openResolutionDialog(item, "closed")}>Закрыть</button></footer>}</article>)}</div></AdminList>}

        {section === "risk" && <AdminList title="Риски" eyebrow="Антифрод" description="События показываются без сетевых отпечатков и чувствительных технических деталей."><div className="admin-risk-list">{risks.length === 0 ? <Empty text="Событий риска нет" /> : risks.map((item) => <article key={item.id}><div className={`admin-risk-score ${item.score >= 70 ? "critical" : item.score >= 40 ? "warning" : "calm"}`}><b>{item.score}</b><small>из 100</small></div><div><h2>{human(item.event_type)}</h2><p>{item.actor_email || "Системное событие"} · {date(item.created_at)}</p><Status value={item.status} /></div>{item.status === "open" && <footer><button disabled={busy} onClick={() => void runOperation({ action: "risk_resolution", targetId: item.id, status: "closed" }, "Событие риска закрыто")}>Закрыть после проверки</button><button className="neutral" disabled={busy} onClick={() => void runOperation({ action: "risk_resolution", targetId: item.id, status: "ignored" }, "Событие отмечено как безопасное")}>Ложное срабатывание</button></footer>}</article>)}</div></AdminList>}

        {section === "system" && <AdminList title="Состояние системы" eyebrow="15 модулей проекта" description={`${activeModules} из ${modules.length || 15} модулей полностью готовы; остальные честно показывают недостающие настройки.`}><div className="admin-system-grid">{modules.map((item) => <article key={item.id} className={item.status}><header><span>{String(item.id).padStart(2, "0")}</span><Status value={item.status} /></header><h2>{item.title}</h2><p>{item.description}</p>{item.missing.length > 0 ? <div><b>Нужно подключить</b>{item.missing.map((name) => <code key={name}>{name}</code>)}</div> : <small>Все обязательные настройки на месте</small>}{item.route && <a href={item.route}>Открыть модуль →</a>}</article>)}</div></AdminList>}

        {section === "audit" && <AdminList title="Журнал аудита" eyebrow="Контроль действий" description="Последние административные и значимые пользовательские операции. Сетевые отпечатки в интерфейс не передаются."><div className="admin-audit-list">{audits.length === 0 ? <Empty text="Записей аудита пока нет" /> : audits.map((item) => <article key={item.id}><span>≡</span><div><b>{human(item.action)}</b><p>{item.actor_email || "Система"}</p></div><small>{human(item.entity_type)}{item.entity_id ? ` #${item.entity_id}` : ""}</small><time>{date(item.created_at)}</time></article>)}</div></AdminList>}
      </div>
    </section>
    {pendingResolution && <div className="transaction-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeResolutionDialog(); }}><section ref={resolutionDialogRef} className="transaction-modal admin-resolution-dialog" role="dialog" aria-modal="true" aria-labelledby="resolution-dialog-title" aria-describedby="resolution-dialog-description" tabIndex={-1}><header><div><span className="customer-kicker">Спор #{pendingResolution.item.id}</span><h2 id="resolution-dialog-title">Зафиксировать решение</h2></div><button type="button" disabled={busy} onClick={closeResolutionDialog} aria-label="Закрыть окно">×</button></header><p id="resolution-dialog-description">Решение увидит покупатель, и оно сохранится в журнале аудита. Статус после сохранения: <b>{human(pendingResolution.status)}</b>.</p><blockquote>{pendingResolution.item.reason}</blockquote><label className="admin-resolution-field">Комментарий к решению<textarea rows={6} value={resolutionText} onChange={(event) => { setResolutionText(event.target.value); setResolutionError(""); }} maxLength={1000} placeholder="Опишите проверенные факты, итог и следующий шаг для покупателя" aria-invalid={Boolean(resolutionError)} aria-describedby={resolutionError ? "resolution-error" : "resolution-hint"} /></label><div className="admin-resolution-meta"><small id="resolution-hint">От 10 до 1000 символов</small><small>{resolutionText.length}/1000</small></div>{resolutionError && <p className="admin-resolution-error" id="resolution-error" role="alert">{resolutionError}</p>}<div className="admin-resolution-actions"><button type="button" className="secondary" disabled={busy} onClick={closeResolutionDialog}>Отмена</button><button type="button" disabled={busy} onClick={() => void saveResolution()}>{busy ? "Сохраняем…" : "Сохранить решение"}</button></div></section></div>}
  </main>;
}

function Metric({ icon, title, value, hint, tone }: { icon: string; title: string; value: number; hint: string; tone: string }) { return <article><span className={tone}>{icon}</span><div><small>{title}</small><b>{value}</b><p>{hint}</p></div></article>; }
function QueueRow({ icon, title, value, action, onClick }: { icon: string; title: string; value: number; action: string; onClick: () => void }) { return <div className="admin-queue-row"><span>{icon}</span><div><b>{title}</b><small>{value === 0 ? "Нет новых событий" : `${value} требуют решения`}</small></div><strong>{value}</strong><button onClick={onClick}>{action}</button></div>; }
function Status({ value }: { value: string }) { return <span className={`admin-status ${value}`}>{human(value)}</span>; }
function Empty({ text }: { text: string }) { return <div className="admin-empty"><span>✓</span><h2>{text}</h2><p>Новые данные появятся здесь автоматически.</p></div>; }
function AdminList({ title, eyebrow, description, children }: { title: string; eyebrow: string; description: string; children: React.ReactNode }) { return <section className="admin-section"><div className="admin-heading"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div>{children}</section>; }
