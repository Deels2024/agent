/* eslint-disable @next/next/no-html-link-for-pages */

import { LEGAL_BUNDLE_VERSION, LEGAL_OPERATOR, legalDocumentHref, legalDocuments } from "../../lib/legal-documents";

const audienceLabels = { all: "Всем пользователям", buyer: "Покупателю", seller: "Продавцу" } as const;

export default function LegalPage() {
  const general = legalDocuments.filter((document) => document.audience === "all");
  const buyer = legalDocuments.filter((document) => document.audience === "buyer");
  const seller = legalDocuments.filter((document) => document.audience === "seller");

  return <main className="legal-page legal-center">
    <header className="product-bar">
      <a href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></a>
      <nav><a href="/platform">Готовность</a><a className="active" href="/legal">Документы</a><a href="/account">Личный кабинет</a></nav>
    </header>

    <section className="legal-hero">
      <span className="customer-kicker">Юридический центр · версия {LEGAL_BUNDLE_VERSION}</span>
      <h1>Все правила — открыто и по ролям</h1>
      <p>Покупатель заранее видит, кто продаёт товар, кто принимает оплату и за что отвечает сервис. Каждый принятый документ сохраняется с версией и временем.</p>
      <div className="legal-model-strip"><span>Покупатель поручает поиск</span><b>→</b><span>Сервис действует как агент</span><b>→</b><span>Продавец заключает договор продажи</span><b>→</b><span>Банк проводит безопасный расчёт</span></div>
    </section>

    <section className="legal-status-card">
      <div><span>Важно до публичного запуска</span><h2>Документы подготовлены как рабочая юридическая конструкция</h2><p>Нужно подставить реквизиты оператора, фактических банков, обработчиков данных и провести финальную проверку профильным юристом. Пока эти данные не заполнены, коммерческие платежи должны оставаться отключёнными.</p></div>
      <dl><div><dt>Оператор</dt><dd>{LEGAL_OPERATOR.legalName}</dd></div><div><dt>Платёжная модель</dt><dd>Продавцу напрямую или через банковского партнёра</dd></div><div><dt>Продавец товара</dt><dd>Магазин, указанный в предложении</dd></div></dl>
    </section>

    <LegalGroup title="Общие документы" description="Регистрация, персональные данные, электронная подпись и технические правила." documents={general} />
    <LegalGroup title="Покупателю" description="Как агент выполняет поручение и сопровождает покупку, не становясь продавцом товара." documents={buyer} />
    <LegalGroup title="Продавцу" description="Подключение магазина, ответственность за товар, расчёты, возвраты и стандарты качества." documents={seller} />

    <section className="legal-consent-note" id="consents"><span>✓</span><div><h2>Как фиксируется согласие</h2><p>В базе сохраняются аккаунт, название и версия документа, роль, дата и время, а также защищённый технический отпечаток. Согласие на персональные данные оформляется отдельно. Реклама всегда необязательна и выключена по умолчанию.</p></div><a href="/account">Мои документы</a></section>

    <footer className="legal-footer"><span>© Агент покупок</span><div><a href="/">Главная</a><a href="/account">Личный кабинет</a><a href="/seller">Продавцам</a><a href="/legal/privacy-policy">Конфиденциальность</a></div></footer>
  </main>;
}

function LegalGroup({ title, description, documents }: { title: string; description: string; documents: typeof legalDocuments }) {
  const noun = documents.length === 1 ? "документ" : documents.length >= 2 && documents.length <= 4 ? "документа" : "документов";
  return <section className="legal-group"><header><div><span className="customer-kicker">{title}</span><h2>{title}</h2><p>{description}</p></div><b>{documents.length} {noun}</b></header><div className="legal-document-grid">{documents.map((document, index) => <a href={legalDocumentHref(document.slug)} key={document.slug}>
    <div><span>{String(index + 1).padStart(2, "0")}</span><em>{audienceLabels[document.audience]}</em>{document.optional && <i>необязательно</i>}</div>
    <h3>{document.shortTitle}</h3><p>{document.summary}</p><footer><small>Версия {document.version}</small><b>Открыть документ →</b></footer>
  </a>)}</div></section>;
}
