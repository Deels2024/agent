"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useState } from "react";

type ModuleStatus = "ready" | "sandbox" | "needs_configuration" | "external_contract";
type Module = { id: number; key: string; title: string; description: string; status: ModuleStatus; implemented: boolean; missing: string[]; route?: string };
type Payload = { summary: { implemented: number; ready: number; needsConfiguration: number; externalContracts: number; sandbox: number; total: number }; modules: Module[]; note: string };

const labels: Record<ModuleStatus, string> = {
  ready: "Готово",
  sandbox: "Тестовый режим",
  needs_configuration: "Нужна настройка",
  external_contract: "Нужен партнёр",
};

export default function PlatformDashboard() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<"all" | ModuleStatus>("all");
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const response = await fetch("/api/platform/status", { cache: "no-store" });
      if (!response.ok) throw new Error("status_unavailable");
      setPayload(await response.json() as Payload);
    } catch { setError("Не удалось обновить состояние модулей"); }
  };

  useEffect(() => { void Promise.resolve().then(load); }, []);
  const modules = useMemo(() => payload?.modules.filter((module) => filter === "all" || module.status === filter) ?? [], [payload, filter]);

  return <main className="platform-page">
    <header className="product-bar"><a href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></a><nav><a href="/account">Покупатель</a><a href="/seller">Продавец</a><a className="active" href="/platform">Готовность</a></nav></header>
    <section className="platform-hero"><div><span className="customer-kicker">Полный контур проекта</span><h1>15 модулей для коммерческого запуска</h1><p>Внутренние функции уже работают на единой базе. Здесь честно показано, что готово, где нужен ключ, а где договор с банком, KYC или службой доставки.</p></div><button onClick={load}>Обновить статус</button></section>
    {error && <p className="platform-error">{error}</p>}
    <section className="platform-summary">
      <article><b>{payload?.summary.implemented ?? "—"}/15</b><span>реализовано в проекте</span></article>
      <article><b>{payload?.summary.ready ?? "—"}</b><span>готово к работе сейчас</span></article>
      <article><b>{payload?.summary.needsConfiguration ?? "—"}</b><span>нужны настройки</span></article>
      <article><b>{payload?.summary.externalContracts ?? "—"}</b><span>нужны внешние партнёры</span></article>
    </section>
    <section className="platform-toolbar" aria-label="Фильтр модулей">
      {(["all", "ready", "sandbox", "needs_configuration", "external_contract"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "Все 15" : labels[value]}</button>)}
    </section>
    <section className="platform-grid">
      {modules.map((module) => <article key={module.key} className={`platform-module ${module.status}`}>
        <div className="platform-module-head"><span>{String(module.id).padStart(2, "0")}</span><em>{labels[module.status]}</em></div>
        <h2>{module.title}</h2><p>{module.description}</p>
        {module.missing.length > 0 && <div className="platform-missing"><b>Для включения:</b>{module.missing.map((item) => <code key={item}>{item}</code>)}</div>}
        {module.route && <a href={module.route}>Открыть модуль →</a>}
      </article>)}
    </section>
    <aside className="platform-note"><b>Важно</b><p>{payload?.note ?? "Проверяем фактическую готовность без имитации внешних операций."}</p><a href="/backend">Проверить подключения маркетплейсов</a></aside>
  </main>;
}
