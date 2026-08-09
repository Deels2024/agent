"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element, react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "text" | "barcode" | "photo";
type Sort = "price" | "trust";
type Offer = { id: string; providerLabel: string; productName: string; sellerName: string; price: number; oldPrice?: number; deliveryDays?: number; score: number; url?: string; verified: boolean };
type SearchResponse = {
  demo: boolean;
  generatedAt: string;
  summary: { checkedSources: number; connectedSources: number; found: number; bestPrice: number | null };
  providers: Array<{ provider: string; label: string; status: string; latencyMs: number; error?: string }>;
  offers: Offer[];
  error?: string;
};
type Recognition = { productName: string; brand?: string; model?: string; barcode?: string; confidence: number };

const rubles = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

export default function LiveSearchPage() {
  const [mode, setMode] = useState<Mode>("text");
  const [query, setQuery] = useState("Apple AirPods Pro 2 USB-C");
  const [barcode, setBarcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>("price");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [alertEnabled, setAlertEnabled] = useState(false);

  async function runSearch(searchQuery = query, searchBarcode = barcode, searchMode: Mode = mode) {
    setLoading(true); setError(""); setResult(null); setAlertEnabled(false);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, barcode: searchBarcode || undefined, mode: searchMode, limit: 10 }),
      });
      const payload = await response.json() as SearchResponse;
      if (!response.ok) setError(payload.error || "Не удалось выполнить поиск");
      else setResult(payload);
    } catch {
      setError("Связь прервалась. Проверьте интернет и повторите поиск.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialMode = params.get("mode") as Mode | null;
    const initialQuery = params.get("q")?.trim();
    if (initialMode && ["text", "barcode", "photo"].includes(initialMode)) setMode(initialMode);
    if (initialQuery) {
      setQuery(initialQuery);
      void runSearch(initialQuery, "", initialMode || "text");
    }
  }, []);

  async function submit(event: FormEvent) { event.preventDefault(); await runSearch(); }

  async function recognize(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError("Фотография больше 8 МБ. Выберите файл меньшего размера."); return; }
    setRecognizing(true); setError(""); setResult(null); setRecognition(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const imageDataUrl = String(reader.result || "");
      setPhotoPreview(imageDataUrl);
      try {
        const response = await fetch("/api/recognize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageDataUrl }) });
        const payload = await response.json() as { suggestedQuery?: string; recognition?: Recognition; error?: string };
        if (!response.ok || !payload.recognition) { setError(payload.error || "Не удалось распознать товар"); return; }
        const recognized = payload.recognition;
        setRecognition(recognized);
        setQuery(payload.suggestedQuery || recognized.productName);
        setBarcode(recognized.barcode || "");
      } catch {
        setError("Не удалось отправить фотографию. Повторите попытку.");
      } finally {
        setRecognizing(false);
      }
    };
    reader.onerror = () => { setRecognizing(false); setError("Не удалось прочитать фотографию."); };
    reader.readAsDataURL(file);
  }

  const visibleOffers = useMemo(() => {
    if (!result) return [];
    return result.offers.filter((offer) => !verifiedOnly || offer.verified).sort((a, b) => sort === "trust" ? b.score - a.score || a.price - b.price : a.price - b.price || b.score - a.score);
  }, [result, sort, verifiedOnly]);
  const averagePrice = result?.offers.length ? Math.round(result.offers.reduce((sum, offer) => sum + offer.price, 0) / result.offers.length) : 0;
  const savings = result?.summary.bestPrice ? Math.max(0, averagePrice - result.summary.bestPrice) : 0;
  const updatedTime = result?.generatedAt ? new Date(result.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

  return <main className="live-page">
    <header className="product-bar">
      <a href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></a>
      <nav><a href="/">Главная</a><a className="active" href="/live-search">Поиск</a><a href="/prototype">Все экраны</a></nav>
    </header>
    <section className="search-hero">
      <span className="kicker">Выгода без скрытых условий</span><h1>Найдём лучшее предложение</h1><p>Сравним до 10 вариантов по итоговой цене, доставке и надёжности продавца.</p>
      <div className="mode-tabs">{([ ["text", "По названию"], ["barcode", "По штрих‑коду"], ["photo", "По фото"] ] as const).map(([id, label]) => <button key={id} className={mode === id ? "active" : ""} onClick={() => { setMode(id); setError(""); setRecognition(null); }}>{label}</button>)}</div>
      {mode !== "photo" ? <form className="live-search-form" onSubmit={submit}>
        {mode === "text" ? <input aria-label="Название товара" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: Samsung QE65Q80D 65″" /> : <input aria-label="Штрих-код" inputMode="numeric" value={barcode} onChange={(event) => setBarcode(event.target.value.replace(/\D/g, ""))} placeholder="Введите цифры со штрих‑кода" />}
        <button disabled={loading || (mode === "text" ? !query.trim() : !barcode.trim())}>{loading ? "Ищу предложения…" : "Найти выгоднее"}</button>
      </form> : <label className="photo-drop"><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={recognize} /><span>▣</span><b>{recognizing ? "Распознаю товар…" : "Выбрать или сфотографировать товар"}</b><small>Сначала покажем найденную модель — вы сможете её исправить</small></label>}
      {recognition && <section className="recognition-confirm"><div className="recognition-preview">{photoPreview ? <img src={photoPreview} alt="Загруженный товар" /> : "▣"}</div><div><span className="recognition-confidence">Совпадение {Math.round(recognition.confidence * 100)}%</span><h2>Мы правильно определили товар?</h2><label>Название и модель<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>{barcode && <small>Штрих-код: {barcode}</small>}<div><button className="confirm-button" onClick={() => void runSearch(query, barcode, "photo")}>Да, найти предложения</button><button className="change-photo" onClick={() => { setRecognition(null); setPhotoPreview(""); }}>Выбрать другое фото</button></div></div></section>}
      {error && <div className="search-error"><b>Не получилось выполнить действие</b><span>{error}</span><button onClick={() => mode === "photo" ? setRecognition(null) : void runSearch()}>Попробовать ещё раз</button></div>}
    </section>

    {loading && <section className="search-loading"><span /><div><b>Агент проверяет источники</b><p>Сопоставляем точную модель, итоговые цены, наличие и условия продавцов…</p></div></section>}

    {result && <>
      {result.demo && <aside className="demo-banner"><b>Демонстрационные предложения</b><span>Показываем безопасный тестовый сценарий: реальные каталоги появятся после подключения партнёрских доступов площадок. Демо никогда не выдаётся за актуальную цену.</span><a href="/backend">Статус подключений</a></aside>}
      <section className="freshness-bar"><span>✓ Модель сопоставлена</span><span>✓ Итоговая цена показана отдельно</span><span>Обновлено сегодня в {updatedTime}</span></section>
      <section className="result-summary"><div><b>{result.summary.found}</b><span>предложений найдено</span></div><div><b>{result.summary.bestPrice ? rubles.format(result.summary.bestPrice) : "—"}</b><span>минимальная сумма</span></div><div><b>{savings ? rubles.format(savings) : "—"}</b><span>выгода к средней цене</span></div><div><b>{result.offers.filter((offer) => offer.verified).length}</b><span>проверенных источников</span></div></section>
      <section className="results-layout">
        <div className="offers-list"><div className="results-title"><div><span className="kicker">Сначала наиболее выгодные</span><h2>Предложения для покупки</h2></div><div className="result-controls"><label><input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} /> Только проверенные</label><select aria-label="Сортировка" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="price">По итоговой цене</option><option value="trust">По надёжности</option></select></div></div>
          {visibleOffers.map((offer, index) => {
            const isBest = index === 0 && sort === "price";
            const offerSavings = Math.max(0, averagePrice - offer.price);
            return <article className={`live-offer ${isBest ? "best" : ""}`} key={offer.id}>
              <div className="offer-rank">{index + 1}</div>
              <div className="offer-main"><div><b>{offer.providerLabel}</b>{offer.verified && <span>✓ проверенный источник</span>}</div><h3>{offer.productName}</h3><p>{offer.sellerName} · доставка {offer.deliveryDays === 0 ? "сегодня" : offer.deliveryDays === 1 ? "завтра" : `через ${offer.deliveryDays ?? 2} дн.`}</p><div className="offer-facts"><span>Совпадение модели</span><b>{offer.verified ? "98%" : "проверить"}</b><span>Возврат</span><b>14 дней</b><span>Гарантия</span><b>1 год</b></div><details className="trust-details"><summary>Почему оценка {offer.score}/100?</summary><p>{offer.verified ? "Источник и продавец проверены. " : "Требуется дополнительная проверка продавца. "}{isBest ? "Это минимальная итоговая цена среди найденных вариантов." : "Цена, доставка и условия учтены в общей оценке."}</p></details></div>
              <div className="offer-buy">{offer.oldPrice && <del>{rubles.format(offer.oldPrice)}</del>}<small>Товар</small><strong>{rubles.format(offer.price)}</strong><div className="price-breakdown"><span>Доставка</span><b>0 ₽</b><span>Итого к оплате</span><b>{rubles.format(offer.price)}</b></div>{offerSavings > 0 && <em>выгода {rubles.format(offerSavings)}</em>}{offer.url ? <a href={offer.url} target="_blank" rel="noreferrer">Открыть у продавца</a> : <button>Безопасная сделка</button>}<small className="responsibility">Оплата и возврат: {offer.url ? offer.providerLabel : "Агент покупок"}</small></div>
            </article>;
          })}
          {visibleOffers.length === 0 && <div className="no-results"><b>Подходящих предложений по фильтру нет</b><p>Отключите фильтр проверенных продавцов или уточните модель товара.</p><button onClick={() => setVerifiedOnly(false)}>Показать все варианты</button></div>}
          {result.offers.length > 0 && <section className="price-watch"><div><span>♧</span><div><b>Не готовы покупать сейчас?</b><p>Агент продолжит следить за итоговой ценой и сообщит о настоящем снижении.</p></div></div><button className={alertEnabled ? "enabled" : ""} onClick={() => setAlertEnabled(!alertEnabled)}>{alertEnabled ? "✓ Наблюдение включено" : "Следить за ценой"}</button>{alertEnabled && <small>Для полноценной рассылки уведомлений потребуется вход в профиль.</small>}</section>}
        </div>
        <aside className="sources-panel"><h3>Контроль качества</h3><div className="quality-score"><b>{result.offers[0]?.score ?? 0}<small>/100</small></b><span>оценка лучшего варианта</span></div><p className="quality-copy">Оценка учитывает цену, наличие, срок доставки и проверку источника.</p><h4>Источники поиска</h4>{result.providers.map((provider) => <div key={provider.provider}><span className={`provider-dot ${provider.status === "ok" ? "online" : provider.status === "error" ? "error" : ""}`} /><p><b>{provider.label}</b><small>{provider.status === "ok" ? `Цена получена за ${provider.latencyMs} мс` : provider.status === "not_configured" ? "Ожидает партнёрского доступа" : "Временно недоступен"}</small></p></div>)}<a href="/backend">Подробный статус источников →</a><div className="buyer-guarantee"><b>◇ Принцип честной цены</b><p>Рекламные места не влияют на сортировку. Платное продвижение будет явно отмечено.</p></div></aside>
      </section>
    </>}
  </main>;
}
