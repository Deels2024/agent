"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element, react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TRANSACTION_CONFIRMATION_VERSION } from "../../lib/legal-documents";

type Mode = "text" | "barcode" | "photo";
type Sort = "price" | "trust";
type Offer = { id: string; provider: string; providerLabel: string; productName: string; sellerName: string; price: number; deliveryPrice?: number; oldPrice?: number; deliveryDays?: number; score: number; matchConfidence?: number; matchLevel?: "exact" | "likely" | "uncertain"; matchReasons?: string[]; quoteId?: string | null; url?: string; imageUrl?: string; warrantyMonths?: number; returnDays?: number; sellerRating?: number; reviewCount?: number; updatedAt?: string; verified: boolean };
type SearchResponse = {
  query: string;
  mode: string;
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
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [query, setQuery] = useState("");
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
  const [alertTarget, setAlertTarget] = useState("");
  const [alertChannel, setAlertChannel] = useState("in_app");
  const [actionMessage, setActionMessage] = useState("");
  const [orderBusy, setOrderBusy] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestForm, setRequestForm] = useState({ targetPrice: "", city: "", quantity: "1" });
  const [pendingOffer, setPendingOffer] = useState<Offer | null>(null);
  const [transactionChecked, setTransactionChecked] = useState(false);

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
      else {
        setResult(payload);
        if (payload.demo) setVerifiedOnly(false);
        const params = new URLSearchParams();
        params.set("mode", searchMode);
        if (searchBarcode) params.set("barcode", searchBarcode); else params.set("q", searchQuery);
        window.history.replaceState(window.history.state, "", `/live-search?${params.toString()}`);
        if (payload.summary.bestPrice) setAlertTarget(String(Math.max(1, Math.floor(payload.summary.bestPrice * 0.95))));
      }
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
    const initialBarcode = params.get("barcode")?.replace(/\D/g, "");
    if (initialMode && ["text", "barcode", "photo"].includes(initialMode)) setMode(initialMode);
    if (initialBarcode) {
      setBarcode(initialBarcode);
      void runSearch(initialBarcode, initialBarcode, "barcode");
    } else if (initialQuery) {
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

  async function createProtectedOrder(offer: Offer) {
    if (!transactionChecked) { setActionMessage("Подтвердите продавца и условия конкретной сделки"); return; }
    if (!offer.quoteId) { setActionMessage("Не удалось зафиксировать цену. Обновите поиск и повторите."); return; }
    setOrderBusy(offer.id); setActionMessage("Фиксируем предложение…");
    const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: offer.quoteId, termsAccepted: true, sellerRoleAccepted: true, transactionConfirmationVersion: TRANSACTION_CONFIRMATION_VERSION }) });
    const payload = await response.json() as { error?: string };
    if ([401, 428].includes(response.status)) { router.push("/register?return_to=/live-search"); return; }
    setActionMessage(response.ok ? result?.demo ? "Тестовая заявка создана. Она отмечена как демо и не требует оплаты." : "Предложение зафиксировано. Заказ появился в личном кабинете." : payload.error ?? "Не удалось создать заявку");
    if (response.ok) { setPendingOffer(null); setTransactionChecked(false); }
    setOrderBusy("");
  }

  async function createDemandRequest(event: FormEvent) {
    event.preventDefault(); setRequesting(true); setActionMessage("Ищем подходящие малые магазины…");
    const response = await fetch("/api/demand-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, barcode: barcode || undefined, targetPrice: requestForm.targetPrice ? Number(requestForm.targetPrice) : undefined, city: requestForm.city, quantity: Number(requestForm.quantity) }) });
    const payload = await response.json() as { error?: string; message?: string; matchedSellers?: number };
    if ([401, 428].includes(response.status)) { router.push("/register?return_to=/live-search"); return; }
    setActionMessage(response.ok ? `${payload.message}. Подходящих магазинов сейчас: ${payload.matchedSellers ?? 0}.` : payload.error ?? "Не удалось отправить запрос");
    if (response.ok) setRequestForm({ targetPrice: "", city: "", quantity: "1" });
    setRequesting(false);
  }

  function currentSearchPath() {
    const params = new URLSearchParams();
    params.set("mode", mode);
    if (mode === "barcode" && barcode) params.set("barcode", barcode); else params.set("q", query);
    return `/live-search?${params.toString()}`;
  }

  async function shareSearch() {
    const url = new URL(currentSearchPath(), window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: `Агент покупок: ${query || barcode}`, text: "Сравнение итоговых цен и условий продавцов", url });
      else await navigator.clipboard.writeText(url);
      setActionMessage(navigator.share ? "Поиск готов к отправке" : "Ссылка на поиск скопирована");
    } catch (shareError) {
      if ((shareError as Error).name !== "AbortError") setActionMessage("Не удалось скопировать ссылку — скопируйте адрес страницы из браузера");
    }
  }

  async function createPriceAlert(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/price-alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: query || barcode, targetPrice: Number(alertTarget), channel: alertChannel }) });
    const payload = await response.json() as { error?: string };
    if (response.status === 401) { router.push(`/login?return_to=${encodeURIComponent(currentSearchPath())}`); return; }
    if (response.status === 428) { router.push(`/register?return_to=${encodeURIComponent(currentSearchPath())}`); return; }
    if (!response.ok) { setActionMessage(payload.error ?? "Не удалось включить контроль цены"); return; }
    setAlertEnabled(true);
    setActionMessage("Готово — агент начал следить за этой моделью");
  }

  const visibleOffers = useMemo(() => {
    if (!result) return [];
    return result.offers.filter((offer) => !verifiedOnly || offer.verified).sort((a, b) => sort === "trust" ? b.score - a.score || a.price - b.price : a.price - b.price || b.score - a.score);
  }, [result, sort, verifiedOnly]);
  const averagePrice = result?.offers.length ? Math.round(result.offers.reduce((sum, offer) => sum + offer.price + (offer.deliveryPrice ?? 0), 0) / result.offers.length) : 0;
  const savings = result?.summary.bestPrice ? Math.max(0, averagePrice - result.summary.bestPrice) : 0;
  const updatedTime = result?.generatedAt ? new Date(result.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

  return <main className="live-page">
    <header className="product-bar">
      <a href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></a>
      <nav><a href="/">Главная</a><a className="active" href="/live-search">Поиск</a><a href="/account">Личный кабинет</a></nav>
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
      {actionMessage && <div className="search-action-message" role="status"><span>✓</span><p>{actionMessage}</p><button onClick={() => setActionMessage("")} aria-label="Закрыть">×</button></div>}
    </section>

    {loading && <section className="search-loading"><span /><div><b>Агент проверяет источники</b><p>Сопоставляем точную модель, итоговые цены, наличие и условия продавцов…</p></div></section>}

    {result && <>
      {result.demo && <aside className="demo-banner"><b>Демонстрационные предложения</b><span>Показываем безопасный тестовый сценарий: реальные каталоги появятся после подключения партнёрских доступов площадок. Демо никогда не выдаётся за актуальную цену.</span></aside>}
      <section className="freshness-bar"><span>✓ Модель сопоставлена</span><span>✓ Итоговая цена показана отдельно</span><span>Обновлено сегодня в {updatedTime}</span><button className="share-search-button" onClick={() => void shareSearch()}>↗ Поделиться поиском</button></section>
      <section className="result-summary"><div><b>{result.summary.found}</b><span>предложений найдено</span></div><div><b>{result.summary.bestPrice ? rubles.format(result.summary.bestPrice) : "—"}</b><span>минимальная сумма</span></div><div><b>{savings ? rubles.format(savings) : "—"}</b><span>выгода к средней цене</span></div><div><b>{result.offers.filter((offer) => offer.verified).length}</b><span>проверенных источников</span></div></section>
      <section className="results-layout">
        <div className="offers-list"><div className="results-title"><div><span className="kicker">Сначала наиболее выгодные</span><h2>Предложения для покупки</h2></div><div className="result-controls"><label><input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} /> Только проверенные</label><select aria-label="Сортировка" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="price">По итоговой цене</option><option value="trust">По надёжности</option></select></div></div>
          {visibleOffers.map((offer, index) => {
            const isBest = index === 0 && sort === "price";
            const offerSavings = Math.max(0, averagePrice - offer.price - (offer.deliveryPrice ?? 0));
            return <article className={`live-offer ${isBest ? "best" : ""}`} key={offer.id}>
              <div className="offer-rank">{index + 1}</div>
              <div className="offer-visual">{offer.imageUrl ? <img src={offer.imageUrl} alt={offer.productName} loading="lazy" /> : <span>▣</span>}</div>
              <div className="offer-main"><div><b>{offer.providerLabel}</b>{offer.verified ? <span>✓ проверенный источник</span> : <span className="demo-source">учебные данные</span>}</div><h3>{offer.productName}</h3><p>{offer.sellerName} · доставка {offer.deliveryDays === 0 ? "сегодня" : offer.deliveryDays === 1 ? "завтра" : `через ${offer.deliveryDays ?? 2} дн.`}</p><div className="offer-facts"><span>Модификация</span><b>{offer.matchLevel === "exact" ? "точная" : offer.matchLevel === "likely" ? "вероятная" : "нужна проверка"} · {offer.matchConfidence ?? 0}%</b><span>Гарантия</span><b>{offer.warrantyMonths ? `${offer.warrantyMonths} мес.` : "уточнить"}</b><span>Возврат</span><b>{result.demo ? "не применяется" : offer.returnDays ? `${offer.returnDays} дней` : "по правилам продавца"}</b><span>Цена действует</span><b>15 минут</b></div><details className="trust-details"><summary>Почему оценка {offer.score}/100?</summary><p>{offer.verified ? "Источник и продавец проверены. " : "Это учебное предложение, оно не подтверждает рыночную цену. "}{(offer.matchReasons ?? []).join(". ")}. {isBest ? "Это минимальная итоговая сумма среди найденных вариантов." : "Товар, доставка и точность модели учтены в общей оценке."}</p></details></div>
              <div className="offer-buy">{offer.oldPrice && <del>{rubles.format(offer.oldPrice)}</del>}<small>Товар</small><strong>{rubles.format(offer.price)}</strong><div className="price-breakdown"><span>Доставка</span><b>{rubles.format(offer.deliveryPrice ?? 0)}</b><span>Итого к оплате</span><b>{rubles.format(offer.price + (offer.deliveryPrice ?? 0))}</b></div>{offerSavings > 0 && <em>выгода {rubles.format(offerSavings)}</em>}{offer.url ? <a href={offer.url} target="_blank" rel="noreferrer">Открыть у продавца</a> : <button disabled={orderBusy === offer.id || !offer.quoteId} onClick={() => { setPendingOffer(offer); setTransactionChecked(false); }}>{orderBusy === offer.id ? "Фиксируем…" : result.demo ? "Создать тестовую заявку" : "Оформить безопасно"}</button>}<small className="responsibility">{result.demo ? "Деньги не списываются" : `Продавец и чек: ${offer.sellerName}`}</small></div>
            </article>;
          })}
          {visibleOffers.length === 0 && <div className="no-results"><b>Подходящих предложений по фильтру нет</b><p>Отключите фильтр проверенных продавцов или уточните модель товара.</p><button onClick={() => setVerifiedOnly(false)}>Показать все варианты</button></div>}
          {result.offers.length > 0 && <section className="price-watch"><div><span>♧</span><div><b>Не готовы покупать сейчас?</b><p>Укажите цену — агент продолжит проверять предложения и сообщит о настоящем снижении.</p></div></div>{alertEnabled ? <strong className="price-watch-enabled">✓ Контроль цены включён</strong> : <form className="price-watch-form" onSubmit={createPriceAlert}><label>Сообщить при цене<input type="number" min="1" step="1" value={alertTarget} onChange={(event) => setAlertTarget(event.target.value)} required /></label><label>Канал<select value={alertChannel} onChange={(event) => setAlertChannel(event.target.value)}><option value="in_app">В кабинете</option><option value="email">Email</option></select></label><button>Следить за ценой</button></form>}<small>Правило сохраняется в личном кабинете. Для email требуется подтверждённый адрес.</small></section>}
          <section className="merchant-demand" id="merchant-demand"><div><span className="kicker">Цена от малого магазина</span><h2>Попросить продавцов сделать предложение</h2><p>Отправим точную модель проверенным магазинам. Они смогут ответить своей ценой, сроком доставки и гарантией в течение 24 часов.</p></div><form onSubmit={createDemandRequest}><label>Желаемая цена<input type="number" min="1" step="0.01" value={requestForm.targetPrice} onChange={(event) => setRequestForm({ ...requestForm, targetPrice: event.target.value })} placeholder="Необязательно" /></label><label>Город<input value={requestForm.city} onChange={(event) => setRequestForm({ ...requestForm, city: event.target.value })} placeholder="Например, Москва" /></label><label>Количество<input type="number" min="1" max="20" value={requestForm.quantity} onChange={(event) => setRequestForm({ ...requestForm, quantity: event.target.value })} /></label><button disabled={requesting}>{requesting ? "Отправляем…" : "Запросить цены"}</button></form></section>
        </div>
        <aside className="sources-panel"><h3>Контроль качества</h3><div className="quality-score"><b>{result.offers[0]?.score ?? 0}<small>/100</small></b><span>оценка лучшего варианта</span></div><p className="quality-copy">Оценка учитывает цену, наличие, срок доставки и проверку источника.</p><h4>Источники поиска</h4>{result.providers.map((provider) => <div key={provider.provider}><span className={`provider-dot ${provider.status === "ok" ? "online" : provider.status === "error" ? "error" : ""}`} /><p><b>{provider.label}</b><small>{provider.status === "ok" ? `Цена получена за ${provider.latencyMs} мс` : provider.status === "not_configured" ? "Ожидает партнёрского доступа" : "Временно недоступен"}</small></p></div>)}<div className="buyer-guarantee"><b>◇ Принцип честной цены</b><p>Рекламные места не влияют на сортировку. Платное продвижение будет явно отмечено.</p></div></aside>
      </section>
    </>}
    {pendingOffer && <div className="transaction-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPendingOffer(null); }}><section className="transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><header><div><span className="customer-kicker">Подтверждение конкретной сделки</span><h2 id="transaction-title">Проверьте продавца и сумму</h2></div><button onClick={() => setPendingOffer(null)} aria-label="Закрыть">×</button></header><div className="transaction-product"><span>▣</span><div><b>{pendingOffer.productName}</b><small>{pendingOffer.providerLabel}</small></div></div><dl><div><dt>Продавец товара</dt><dd>{pendingOffer.sellerName}</dd></div><div><dt>Цена товара</dt><dd>{rubles.format(pendingOffer.price)}</dd></div><div><dt>Доставка</dt><dd>{rubles.format(pendingOffer.deliveryPrice ?? 0)}</dd></div><div className="total"><dt>Итого</dt><dd>{rubles.format(pendingOffer.price + (pendingOffer.deliveryPrice ?? 0))}</dd></div></dl><div className="transaction-roles"><p><span>Магазин</span><b>Продаёт товар, выдаёт чек, отвечает за качество и возврат</b></p><p><span>Агент покупок</span><b>Выполняет поручение, фиксирует цену и передаёт заказ</b></p><p><span>Платёжный партнёр</span><b>Проводит безопасный расчёт после подключения</b></p></div><label className="transaction-confirm"><input type="checkbox" checked={transactionChecked} onChange={(event) => setTransactionChecked(event.target.checked)} /><span>Подтверждаю точную модель, продавца и итоговую сумму. Понимаю, что договор продажи заключается с <b>{pendingOffer.sellerName}</b>, и принимаю <a href="/legal/buyer-agency-offer" target="_blank">агентскую оферту</a> и <a href="/legal/safe-deal-rules" target="_blank">правила безопасной сделки</a>.</span></label><button className="transaction-submit" disabled={!transactionChecked || orderBusy === pendingOffer.id} onClick={() => void createProtectedOrder(pendingOffer)}>{orderBusy === pendingOffer.id ? "Фиксируем предложение…" : result?.demo ? "Создать демо-заявку без оплаты" : "Подтвердить и создать заявку"}</button><small>Версия подтверждения {TRANSACTION_CONFIRMATION_VERSION}. Деньги на этом шаге не списываются.</small></section></div>}
  </main>;
}
