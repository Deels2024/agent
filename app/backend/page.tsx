"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useState } from "react";

type Provider = { provider: string; label: string; configured: boolean; missing: string[]; coverage: string };
type StatusPayload = {
  providers: Provider[];
  configured: number;
  total: number;
  recognition: { label: string; configured: boolean; missing: string[] };
  scopeNotice: string;
};
type HistoryPayload = { searches?: Array<{ id: number; query: string; searchType: string; offerCount: number; isDemo: boolean; createdAt: string }> };

async function fetchDashboard() {
  const [statusResponse, historyResponse] = await Promise.all([
    fetch("/api/marketplaces/status", { cache: "no-store" }),
    fetch("/api/history", { cache: "no-store" }),
  ]);
  return {
    status: await statusResponse.json() as StatusPayload,
    history: historyResponse.ok ? await historyResponse.json() as HistoryPayload : {},
  };
}

export default function BackendPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [history, setHistory] = useState<HistoryPayload>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetchDashboard().then((data) => {
      if (!active) return;
      setStatus(data.status);
      setHistory(data.history);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const refresh = async () => {
    setLoading(true);
    const data = await fetchDashboard();
    setStatus(data.status);
    setHistory(data.history);
    setLoading(false);
  };

  return <main className="backend-page">
    <header className="product-bar">
      <a href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></a>
      <nav><a href="/live-search">Живой поиск</a><a className="active" href="/backend">Интеграции</a></nav>
    </header>
    <section className="backend-hero">
      <div><span className="kicker">Центр подключений</span><h1>Backend маркетплейсов</h1><p>Единый сервер принимает запрос покупателя, проверяет подключённые каталоги и возвращает до 10 предложений по цене и надёжности.</p></div>
      <div className="backend-summary"><b>{status?.configured ?? 0}/{status?.total ?? 3}</b><span>площадок подключено</span><button onClick={refresh} disabled={loading}>{loading ? "Проверяю…" : "Проверить снова"}</button></div>
    </section>

    <section className="provider-grid">
      {status?.providers.map((provider) => <article className="provider-card" key={provider.provider}>
        <div className="provider-title"><span className={`provider-dot ${provider.configured ? "online" : ""}`} /><h2>{provider.label}</h2><em>{provider.configured ? "Готов" : "Нужен доступ"}</em></div>
        <p>{provider.coverage}</p>
        {provider.configured ? <div className="ready-box">✓ Сервер может запрашивать товары и цены</div> : <div className="missing-box"><b>Для запуска нужны:</b>{provider.missing.map((item) => <code key={item}>{item}</code>)}</div>}
      </article>)}
      {status && <article className="provider-card vision-card">
        <div className="provider-title"><span className={`provider-dot ${status.recognition.configured ? "online" : ""}`} /><h2>Поиск по фото</h2><em>{status.recognition.configured ? "Готов" : "Нужен ключ"}</em></div>
        <p>OpenAI Vision определяет бренд, модель и видимый штрих‑код, затем запускает обычный поиск цен.</p>
        {!status.recognition.configured && <div className="missing-box"><b>Для запуска нужен:</b><code>OPENAI_API_KEY</code></div>}
      </article>}
    </section>

    <section className="backend-columns">
      <article className="backend-panel">
        <span className="kicker">Как это работает</span>
        <h2>Один запрос — несколько источников</h2>
        <ol className="backend-flow">
          <li><b>1</b><span><strong>Распознаём товар</strong><small>Название, фото, штрих‑код или ссылка</small></span></li>
          <li><b>2</b><span><strong>Опрашиваем площадки параллельно</strong><small>С таймаутами, нормализацией и защитой ключей</small></span></li>
          <li><b>3</b><span><strong>Сопоставляем одну модель</strong><small>Убираем дубли и несовпадающие варианты</small></span></li>
          <li><b>4</b><span><strong>Ранжируем предложения</strong><small>Цена, наличие, доставка и проверка продавца</small></span></li>
          <li><b>5</b><span><strong>Сохраняем историю цены</strong><small>Для уведомлений и доказательства выгоды</small></span></li>
        </ol>
      </article>
      <article className="backend-panel">
        <span className="kicker">Последние запросы</span>
        <h2>История backend</h2>
        <div className="history-list">
          {(history.searches ?? []).length === 0 && <p className="empty-copy">Поисков ещё нет. Запустите первый запрос в живом поиске.</p>}
          {(history.searches ?? []).slice(0, 8).map((item) => <div key={item.id}><span>⌕</span><p><b>{item.query}</b><small>{item.searchType} · {item.offerCount} предложений{item.isDemo ? " · демо" : ""}</small></p></div>)}
        </div>
        <a className="primary-link" href="/live-search">Открыть живой поиск →</a>
      </article>
    </section>

    {status && <aside className="scope-notice"><b>Важно про официальный доступ</b><p>{status.scopeNotice}</p><p>Секретные ключи нельзя вводить на клиенте или присылать в чат — они добавляются только в защищённые переменные сервера.</p></aside>}
  </main>;
}
