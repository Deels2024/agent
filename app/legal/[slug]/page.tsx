/* eslint-disable @next/next/no-html-link-for-pages */

import { notFound } from "next/navigation";
import { getLegalDocument, LEGAL_OPERATOR, legalDocuments } from "../../../lib/legal-documents";

export function generateStaticParams() {
  return legalDocuments.map((document) => ({ slug: document.slug }));
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const document = getLegalDocument(slug);
  if (!document) notFound();

  return <main className="legal-page legal-document-page">
    <header className="product-bar"><a href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></a><nav><a href="/legal">← Все документы</a><a href="/account">Личный кабинет</a></nav></header>
    <section className="legal-document-hero"><div><span className="customer-kicker">{document.audience === "seller" ? "Документ продавца" : document.audience === "buyer" ? "Документ покупателя" : "Общий документ"}</span><h1>{document.title}</h1><p>{document.summary}</p></div><dl><div><dt>Версия</dt><dd>{document.version}</dd></div><div><dt>Действует с</dt><dd>{document.effectiveDate}</dd></div><div><dt>Статус</dt><dd>{document.optional ? "Добровольное согласие" : "Основной документ"}</dd></div></dl></section>
    <aside className="legal-draft-warning"><b>Перед коммерческим запуском</b><span>Заполните реквизиты оператора и фактических партнёров. Текущий оператор: {LEGAL_OPERATOR.legalName}</span></aside>
    <div className="legal-document-layout"><nav><b>Содержание</b>{document.sections.map((section, index) => <a key={section.title} href={`#section-${index + 1}`}>{section.title}</a>)}</nav><article>{document.sections.map((section, index) => <section id={`section-${index + 1}`} key={section.title}><h2>{section.title}</h2>{section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}</article></div>
    <section className="legal-document-actions"><div><b>Документ всегда доступен в юридическом центре</b><p>При регистрации и значимых действиях сервис фиксирует именно ту версию, которую пользователь принял.</p></div><a href="/legal">Вернуться ко всем документам</a></section>
  </main>;
}
