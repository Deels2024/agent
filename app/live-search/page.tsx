"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element, react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TRANSACTION_CONFIRMATION_VERSION } from "../../lib/legal-documents";
import { useAccessibleDialog } from "../ui/use-accessible-dialog";

type Mode = "text" | "barcode" | "photo";
type Sort = "price" | "trust" | "speed";
type Offer = { id: string; provider: string; providerLabel: string; productName: string; sellerName: string; price: number; deliveryPrice?: number; oldPrice?: number; deliveryDays?: number; score: number; matchConfidence?: number; matchLevel?: "exact" | "likely" | "uncertain"; matchReasons?: string[]; quoteId?: string | null; url?: string; imageUrl?: string; warrantyMonths?: number; returnDays?: number; sellerRating?: number; reviewCount?: number; updatedAt?: string; verified: boolean };
type SearchResponse = {
  searchId: number | null;
  query: string;
  mode: string;
  demo: boolean;
  generatedAt: string;
  summary: { checkedSources: number; connectedSources: number; found: number; bestPrice: number | null };
  providers: Array<{ provider: string; label: string; status: string; latencyMs: number; offers?: Offer[]; error?: string }>;
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
  const [exactOnly, setExactOnly] = useState(false);
  const [deliveryMax, setDeliveryMax] = useState("any");
  const [maxTotal, setMaxTotal] = useState("");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertTarget, setAlertTarget] = useState("");
  const [alertChannel, setAlertChannel] = useState("in_app");
  const [actionMessage, setActionMessage] = useState("");
  const [orderBusy, setOrderBusy] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestForm, setRequestForm] = useState({ targetPrice: "", city: "", quantity: "1" });
  const [pendingOffer, setPendingOffer] = useState<Offer | null>(null);
  const [transactionChecked, setTransactionChecked] = useState(false);
  const [feedbackState, setFeedbackState] = useState<"idle" | "reasons" | "saving" | "sent">("idle");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const closeTransactionDialog = useCallback(() => { setPendingOffer(null); setTransactionChecked(false); }, []);
  const transactionDialogRef = useAccessibleDialog(Boolean(pendingOffer), closeTransactionDialog);

  async function runSearch(searchQuery = query, searchBarcode = barcode, searchMode: Mode = mode) {
    setLoading(true); setError(""); setResult(null); setAlertEnabled(false); setComparisonIds([]); setFeedbackState("idle"); setFeedbackMessage("");
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
        if (!payload.demo && payload.summary.bestPrice) setAlertTarget(String(Math.max(1, Math.floor(payload.summary.bestPrice * 0.95))));
        else setAlertTarget("");
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
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: offer.quoteId, termsAccepted: true, sellerRoleAccepted: true, transactionConfirmationVersion: TRANSACTION_CONFIRMATION_VERSION }) });
      const payload = await response.json() as { error?: string };
      if ([401, 428].includes(response.status)) { router.push("/register?return_to=/live-search"); return; }
      setActionMessage(response.ok ? result?.demo ? "Тестовая заявка создана. Она отмечена как демо и не требует оплаты." : "Предложение зафиксировано. Заказ появился в личном кабинете." : payload.error ?? "Не удалось создать заявку");
      if (response.ok) { setPendingOffer(null); setTransactionChecked(false); }
    } catch {
      setActionMessage("Нет связи с сервером. Заявка не создана и деньги не списаны.");
    } finally {
      setOrderBusy("");
    }
  }

  async function createDemandRequest(event: FormEvent) {
    event.preventDefault(); setRequesting(true); setActionMessage("Ищем подходящие малые магазины…");
    try {
      const response = await fetch("/api/demand-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, barcode: barcode || undefined, targetPrice: requestForm.targetPrice ? Number(requestForm.targetPrice) : undefined, city: requestForm.city, quantity: Number(requestForm.quantity) }) });
      const payload = await response.json() as { error?: string; message?: string; matchedSellers?: number };
      if ([401, 428].includes(response.status)) { router.push("/register?return_to=/live-search"); return; }
      setActionMessage(response.ok ? `${payload.message}. Подходящих магазинов сейчас: ${payload.matchedSellers ?? 0}.` : payload.error ?? "Не удалось отправить запрос");
      if (response.ok) setRequestForm({ targetPrice: "", city: "", quantity: "1" });
    } catch {
      setActionMessage("Нет связи с сервером. Запрос магазинам не отправлен.");
    } finally {
      setRequesting(false);
    }
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
    try {
      const response = await fetch("/api/price-alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: query || barcode, targetPrice: Number(alertTarget), channel: alertChannel }) });
      const payload = await response.json() as { error?: string };
      if (response.status === 401) { router.push(`/login?return_to=${encodeURIComponent(currentSearchPath())}`); return; }
      if (response.status === 428) { router.push(`/register?return_to=${encodeURIComponent(currentSearchPath())}`); return; }
      if (!response.ok) { setActionMessage(payload.error ?? "Не удалось включить контроль цены"); return; }
      setAlertEnabled(true);
      setActionMessage("Готово — агент начал следить за этой моделью");
    } catch {
      setActionMessage("Нет связи с сервером. Контроль цены не включён.");
    }
  }

  async function sendFeedback(sentiment: "helpful" | "not_helpful", reason = "") {
    if (!result?.searchId) return;
    setFeedbackState("saving"); setFeedbackMessage("");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ searchId: result.searchId, sentiment, reason }) });
      const payload = await response.json() as { error?: string; message?: string };
      if (!response.ok) { setFeedbackState(sentiment === "helpful" ? "idle" : "reasons"); setFeedbackMessage(payload.error ?? "Не удалось сохранить оценку"); return; }
      setFeedbackState("sent"); setFeedbackMessage(payload.message ?? "Спасибо за оценку");
    } catch {
      setFeedbackState(sentiment === "helpful" ? "idle" : "reasons"); setFeedbackMessage("Нет связи с сервером. Попробуйте ещё раз.");
    }
  }

  const visibleOffers = useMemo(() => {
    if (!result) return [];
    const totalLimit = Number(maxTotal) || Infinity;
    const deliveryLimit = deliveryMax === "any" ? Infinity : Number(deliveryMax);
    return result.offers.filter((offer) => (!verifiedOnly || offer.verified) && (!exactOnly || offer.matchLevel === "exact") && (offer.deliveryDays ?? Infinity) <= deliveryLimit && offer.price + (offer.deliveryPrice ?? 0) <= totalLimit).sort((a, b) => sort === "trust" ? b.score - a.score || a.price - b.price : sort === "speed" ? (a.deliveryDays ?? Infinity) - (b.deliveryDays ?? Infinity) || a.price - b.price : a.price + (a.deliveryPrice ?? 0) - b.price - (b.deliveryPrice ?? 0) || b.score - a.score);
  }, [deliveryMax, exactOnly, maxTotal, result, sort, verifiedOnly]);
  const comparisonOffers = useMemo(() => result?.offers.filter((offer) => comparisonIds.includes(offer.id)) ?? [], [comparisonIds, result]);
  const averagePrice = result?.offers.length ? Math.round(result.offers.reduce((sum, offer) => sum + offer.price + (offer.deliveryPrice ?? 0), 0) / result.offers.length) : 0;
  const savings = !result?.demo && result?.summary.bestPrice ? Math.max(0, averagePrice - result.summary.bestPrice) : 0;
  const updatedTime = result?.generatedAt ? new Date(result.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";
  const recommendedOffer = useMemo(() => result?.demo ? null : visibleOffers.slice().sort((a, b) => b.score - a.score || a.price + (a.deliveryPrice ?? 0) - b.price - (b.deliveryPrice ?? 0))[0] ?? null, [result?.demo, visibleOffers]);
  const recommendedSavings = recommendedOffer ? Math.max(0, averagePrice - recommendedOffer.price - (recommendedOffer.deliveryPrice ?? 0)) : 0;
  const filtersActive = exactOnly || deliveryMax !== "any" || Boolean(maxTotal);

  function toggleComparison(offerId: string) {
    setComparisonIds((current) => {
      if (current.includes(offerId)) return current.filter((id) => id !== offerId);
      if (current.length >= 3) {
        setActionMessage("Для удобного сравнения можно выбрать не более трёх вариантов");
        return current;
      }
      return [...current, offerId];
    });
  }

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
      {result.demo && <aside className="demo-banner"><b>Учебный режим — не рыночные цены</b><span>Эти варианты нужны только для проверки интерфейса. Рейтинг, реальная экономия и срок действия цены для них не рассчитываются.</span></aside>}
      <section className="freshness-bar"><span>✓ Модель сопоставлена</span><span>✓ Итоговая сумма показана отдельно</span><span>{result.demo ? "Учебный сценарий" : `Проверено сегодня в ${updatedTime}`}</span><button className="share-search-button" onClick={() => void shareSearch()}>↗ Поделиться поиском</button></section>
      <section className="result-summary"><div><b>{result.summary.found}</b><span>{result.demo ? "учебных вариантов" : "предложений найдено"}</span></div><div><b>{result.summary.bestPrice ? rubles.format(result.summary.bestPrice) : "—"}</b><span>{result.demo ? "пример итоговой суммы" : "минимальная сумма"}</span></div><div><b>{savings ? rubles.format(savings) : "—"}</b><span>{result.demo ? "в демо не рассчитывается" : "выгода к средней цене"}</span></div><div><b>{result.offers.filter((offer) => offer.verified).length}</b><span>проверенных источников</span></div></section>
      {recommendedOffer && <section className="agent-recommendation"><div className="agent-recommendation-mark">✦</div><div><span className="kicker">Рекомендация агента</span><h2>{recommendedOffer.productName}</h2><p><b>{recommendedOffer.sellerName}</b> — сильное сочетание итоговой цены, точности модели и надёжности. Совпадение {recommendedOffer.matchConfidence ?? 0}%, оценка {recommendedOffer.score}/100{recommendedSavings ? `, выгода к средней цене ${rubles.format(recommendedSavings)}` : ""}.</p><small>Рекомендация не оплачена продавцом. Перед оформлением ещё раз покажем продавца и итоговую сумму.</small></div><button type="button" onClick={() => document.getElementById(`offer-${recommendedOffer.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>Посмотреть вариант</button></section>}
      <section className="results-layout">
        <div className="offers-list"><div className="results-title"><div><span className="kicker">Сначала наиболее выгодные</span><h2>Предложения для покупки</h2></div><div className="result-controls"><label><input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} /> Только проверенные</label><select aria-label="Сортировка" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="price">По итоговой цене</option><option value="trust">По надёжности</option><option value="speed">По сроку доставки</option></select></div></div>
          <div className="advanced-filters" aria-label="Фильтры предложений"><label><span>Совпадение</span><select value={exactOnly ? "exact" : "any"} onChange={(event) => setExactOnly(event.target.value === "exact")}><option value="any">Точное и вероятное</option><option value="exact">Только точная модель</option></select></label><label><span>Доставка</span><select value={deliveryMax} onChange={(event) => setDeliveryMax(event.target.value)}><option value="any">Любой срок</option><option value="0">Сегодня</option><option value="1">До завтра</option><option value="3">До 3 дней</option><option value="7">До 7 дней</option></select></label><label><span>Итого не дороже</span><input type="number" min="1" step="100" value={maxTotal} onChange={(event) => setMaxTotal(event.target.value)} placeholder="Без ограничения" /></label>{filtersActive && <button type="button" onClick={() => { setExactOnly(false); setDeliveryMax("any"); setMaxTotal(""); }}>Сбросить</button>}</div>
          {visibleOffers.map((offer, index) => {
            const isBest = index === 0 && sort === "price";
            const offerSavings = Math.max(0, averagePrice - offer.price - (offer.deliveryPrice ?? 0));
            return <article id={`offer-${offer.id}`} className={`live-offer ${isBest ? "best" : ""}`} key={offer.id}>
              <div className="offer-rank">{index + 1}</div>
              <div className="offer-visual">{offer.imageUrl ? <img src={offer.imageUrl} alt={offer.productName} loading="lazy" /> : <span>▣</span>}</div>
              <div className="offer-main">{isBest && <span className="offer-choice">Минимальная итоговая сумма</span>}<div><b>{offer.providerLabel}</b>{offer.verified ? <span>✓ проверенный источник</span> : <span className="demo-source">учебные данные</span>}</div><h3>{offer.productName}</h3><p>{offer.sellerName} · доставка {offer.deliveryDays === 0 ? "сегодня" : offer.deliveryDays === 1 ? "завтра" : `через ${offer.deliveryDays ?? 2} дн.`}</p><div className="offer-facts"><span>Модификация</span><b>{offer.matchLevel === "exact" ? "точная" : offer.matchLevel === "likely" ? "вероятная" : "нужна проверка"} · {offer.matchConfidence ?? 0}%</b><span>Гарантия</span><b>{offer.warrantyMonths ? `${offer.warrantyMonths} мес.` : "уточнить"}</b><span>Возврат</span><b>{result.demo ? "не применяется" : offer.returnDays ? `${offer.returnDays} дней` : "по правилам продавца"}</b><span>{result.demo ? "Статус" : "Обновлено"}</span><b>{result.demo ? "учебный вариант" : freshnessLabel(offer.updatedAt)}</b><span>{result.demo ? "Данные" : "Цена зафиксируется"}</span><b>{result.demo ? "не рыночные" : "на 15 минут"}</b></div><details className="trust-details"><summary>{result.demo ? "Что означает этот вариант?" : `Почему оценка ${offer.score}/100?`}</summary><p>{result.demo ? "Учебное предложение демонстрирует состав результата и не подтверждает рыночную цену или надёжность магазина." : `${offer.verified ? "Источник и продавец проверены. " : "Источник требует дополнительной проверки. "}${(offer.matchReasons ?? []).join(". ")}. ${isBest ? "Это минимальная итоговая сумма среди найденных вариантов." : "Товар, доставка и точность модели учтены в общей оценке."}`}</p></details></div>
              <div className="offer-buy">{!result.demo && offer.oldPrice && <del>{rubles.format(offer.oldPrice)}</del>}<small>Товар</small><strong>{rubles.format(offer.price)}</strong><div className="price-breakdown"><span>Доставка</span><b>{rubles.format(offer.deliveryPrice ?? 0)}</b><span>Итого к оплате</span><b>{rubles.format(offer.price + (offer.deliveryPrice ?? 0))}</b></div>{!result.demo && offerSavings > 0 && <em>выгода {rubles.format(offerSavings)}</em>}<button type="button" className={`compare-offer-button ${comparisonIds.includes(offer.id) ? "selected" : ""}`} onClick={() => toggleComparison(offer.id)}>{comparisonIds.includes(offer.id) ? "✓ В сравнении" : "Сравнить"}</button>{offer.url ? <a href={offer.url} target="_blank" rel="noreferrer">Открыть у продавца</a> : <button disabled={orderBusy === offer.id || !offer.quoteId} onClick={() => { setPendingOffer(offer); setTransactionChecked(false); }}>{orderBusy === offer.id ? "Фиксируем…" : result.demo ? "Создать тестовую заявку" : "Оформить безопасно"}</button>}<small className="responsibility">{result.demo ? "Учебная заявка · деньги не списываются" : `Продавец и чек: ${offer.sellerName}`}</small></div>
            </article>;
          })}
          {visibleOffers.length === 0 && <div className="no-results"><b>Подходящих предложений по фильтру нет</b><p>Сбросьте ограничения или уточните модель товара.</p><button onClick={() => { setVerifiedOnly(false); setExactOnly(false); setDeliveryMax("any"); setMaxTotal(""); }}>Сбросить фильтры</button></div>}
          {comparisonOffers.length > 0 && <section className="offer-comparison" aria-labelledby="comparison-title"><header><div><span className="kicker">Выбрано {comparisonOffers.length} из 3</span><h2 id="comparison-title">Сравнение вариантов</h2></div><button type="button" onClick={() => setComparisonIds([])}>Очистить</button></header><div className="offer-comparison-scroll"><table><thead><tr><th>Критерий</th>{comparisonOffers.map((offer) => <th key={offer.id}><b>{offer.sellerName}</b><small>{offer.providerLabel}</small></th>)}</tr></thead><tbody><tr><th>Товар</th>{comparisonOffers.map((offer) => <td key={offer.id}>{offer.productName}</td>)}</tr><tr><th>Итого</th>{comparisonOffers.map((offer) => <td key={offer.id}><b>{rubles.format(offer.price + (offer.deliveryPrice ?? 0))}</b></td>)}</tr><tr><th>Доставка</th>{comparisonOffers.map((offer) => <td key={offer.id}>{offer.deliveryDays === 0 ? "сегодня" : offer.deliveryDays === 1 ? "завтра" : `через ${offer.deliveryDays ?? 2} дн.`}</td>)}</tr><tr><th>Совпадение</th>{comparisonOffers.map((offer) => <td key={offer.id}>{offer.matchConfidence ?? 0}%</td>)}</tr><tr><th>Надёжность</th>{comparisonOffers.map((offer) => <td key={offer.id}>{result.demo ? "не оценивается" : `${offer.score}/100`}</td>)}</tr></tbody></table></div></section>}
          {result.offers.length > 0 && <section className="price-watch"><div><span>♧</span><div><b>{result.demo ? "Контроль цены включится с реальными источниками" : "Не готовы покупать сейчас?"}</b><p>{result.demo ? "Для учебной цены уведомление не создаётся — она не отражает рынок." : "Укажите цену — агент продолжит проверять предложения и сообщит о настоящем снижении."}</p></div></div>{result.demo ? <strong className="price-watch-demo">Доступно после подключения площадок</strong> : alertEnabled ? <strong className="price-watch-enabled">✓ Контроль цены включён</strong> : <form className="price-watch-form" onSubmit={createPriceAlert}><label>Сообщить при цене<input type="number" min="1" step="1" value={alertTarget} onChange={(event) => setAlertTarget(event.target.value)} required /></label><label>Канал<select value={alertChannel} onChange={(event) => setAlertChannel(event.target.value)}><option value="in_app">В кабинете</option><option value="email">Email</option></select></label><button>Следить за ценой</button></form>}<small>{result.demo ? "Мы не сохраняем искусственную цену как реальное правило." : "Правило сохраняется в личном кабинете. Для email требуется подтверждённый адрес."}</small></section>}
          <section className="merchant-demand" id="merchant-demand"><div><span className="kicker">Цена от малого магазина</span><h2>Попросить продавцов сделать предложение</h2><p>Отправим точную модель проверенным магазинам. Они смогут ответить своей ценой, сроком доставки и гарантией в течение 24 часов.</p></div><form onSubmit={createDemandRequest}><label>Желаемая цена<input type="number" min="1" step="0.01" value={requestForm.targetPrice} onChange={(event) => setRequestForm({ ...requestForm, targetPrice: event.target.value })} placeholder="Необязательно" /></label><label>Город<input value={requestForm.city} onChange={(event) => setRequestForm({ ...requestForm, city: event.target.value })} placeholder="Например, Москва" /></label><label>Количество<input type="number" min="1" max="20" value={requestForm.quantity} onChange={(event) => setRequestForm({ ...requestForm, quantity: event.target.value })} /></label><button disabled={requesting}>{requesting ? "Отправляем…" : "Запросить цены"}</button></form></section>
          {result.searchId && <section className="search-feedback" aria-labelledby="search-feedback-title"><div><span>◎</span><div><h2 id="search-feedback-title">Этот поиск помог выбрать?</h2><p>Оценка займёт несколько секунд и покажет нам, что улучшить.</p></div></div>{feedbackState === "sent" ? <strong>✓ {feedbackMessage}</strong> : feedbackState === "reasons" || feedbackState === "saving" ? <div className="feedback-reasons"><b>Что помешало?</b>{[["wrong_product", "Не тот товар"], ["few_offers", "Мало вариантов"], ["price_unclear", "Непонятна цена"], ["other", "Другая причина"]].map(([value, label]) => <button key={value} disabled={feedbackState === "saving"} onClick={() => void sendFeedback("not_helpful", value)}>{label}</button>)}<button className="feedback-back" disabled={feedbackState === "saving"} onClick={() => setFeedbackState("idle")}>Назад</button></div> : <div className="feedback-actions"><button onClick={() => void sendFeedback("helpful", "clear_comparison")}>Да, помог</button><button onClick={() => setFeedbackState("reasons")}>Пока нет</button></div>}{feedbackMessage && feedbackState !== "sent" && <small role="alert">{feedbackMessage}</small>}</section>}
        </div>
        <aside className="sources-panel"><h3>Контроль качества</h3><div className={`quality-score ${result.demo ? "demo" : ""}`}><b>{result.demo ? "—" : result.offers[0]?.score ?? 0}{!result.demo && <small>/100</small>}</b><span>{result.demo ? "демо не оценивается" : "оценка лучшего варианта"}</span></div><p className="quality-copy">{result.demo ? "Настоящая оценка появится только для предложения из подключённого источника." : "Оценка учитывает цену, наличие, срок доставки и проверку источника."}</p><h4>Источники поиска</h4>{result.providers.map((provider) => <div key={provider.provider}><span className={`provider-dot ${provider.status === "ok" ? "online" : provider.status === "error" ? "error" : ""}`} /><p><b>{provider.label}</b><small>{provider.status === "ok" ? provider.offers?.length ? `${provider.offers.length} предложений · ${provider.latencyMs} мс` : "Источник проверен, совпадений нет" : provider.status === "not_configured" ? "Ожидает партнёрского доступа" : "Временно недоступен"}</small></p></div>)}<div className="buyer-guarantee"><b>◇ Принцип честной цены</b><p>Рекламные места не влияют на сортировку. Платное продвижение будет явно отмечено.</p></div></aside>
      </section>
    </>}
    {pendingOffer && <div className="transaction-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeTransactionDialog(); }}><section ref={transactionDialogRef} className="transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-title" aria-describedby="transaction-dialog-note" tabIndex={-1}><header><div><span className="customer-kicker">Подтверждение конкретной сделки</span><h2 id="transaction-title">Проверьте продавца и сумму</h2></div><button onClick={closeTransactionDialog} aria-label="Закрыть окно">×</button></header><div className="transaction-product"><span>▣</span><div><b>{pendingOffer.productName}</b><small>{pendingOffer.providerLabel}</small></div></div><dl><div><dt>Продавец товара</dt><dd>{pendingOffer.sellerName}</dd></div><div><dt>Цена товара</dt><dd>{rubles.format(pendingOffer.price)}</dd></div><div><dt>Доставка</dt><dd>{rubles.format(pendingOffer.deliveryPrice ?? 0)}</dd></div><div className="total"><dt>Итого</dt><dd>{rubles.format(pendingOffer.price + (pendingOffer.deliveryPrice ?? 0))}</dd></div></dl><div className="transaction-roles"><p><span>Магазин</span><b>Продаёт товар, выдаёт чек, отвечает за качество и возврат</b></p><p><span>Агент покупок</span><b>Выполняет поручение, фиксирует цену и передаёт заказ</b></p><p><span>Платёжный партнёр</span><b>Проводит безопасный расчёт после подключения</b></p></div><label className="transaction-confirm"><input type="checkbox" checked={transactionChecked} onChange={(event) => setTransactionChecked(event.target.checked)} /><span>Подтверждаю точную модель, продавца и итоговую сумму. Понимаю, что договор продажи заключается с <b>{pendingOffer.sellerName}</b>, и принимаю <a href="/legal/buyer-agency-offer" target="_blank">агентскую оферту</a> и <a href="/legal/safe-deal-rules" target="_blank">правила безопасной сделки</a>.</span></label><button className="transaction-submit" disabled={!transactionChecked || orderBusy === pendingOffer.id} onClick={() => void createProtectedOrder(pendingOffer)}>{orderBusy === pendingOffer.id ? "Фиксируем предложение…" : result?.demo ? "Создать демо-заявку без оплаты" : "Подтвердить и создать заявку"}</button><small id="transaction-dialog-note">Версия подтверждения {TRANSACTION_CONFIRMATION_VERSION}. Деньги на этом шаге не списываются. Для закрытия можно нажать Esc.</small></section></div>}
  </main>;
}

function freshnessLabel(value?: string) {
  if (!value) return "время не указано";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return "время не указано";
  if (minutes < 2) return "только что";
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} ч. назад` : `${Math.round(hours / 24)} дн. назад`;
}
