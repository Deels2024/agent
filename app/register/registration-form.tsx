"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { FormEvent, useMemo, useState } from "react";
import { buyerRegistrationDocuments, optionalRegistrationDocuments } from "../../lib/legal-documents";

type RoleIntent = "buyer" | "seller";

export default function RegistrationForm({ name, email, returnTo, initialRole, logoutHref }: { name: string; email: string; returnTo: string; initialRole: RoleIntent; logoutHref: string }) {
  const [roleIntent, setRoleIntent] = useState<RoleIntent>(initialRole);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allRequired = useMemo(() => buyerRegistrationDocuments.every((document) => checked[document.slug]), [checked]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!allRequired) { setError("Откройте и отдельно подтвердите каждый обязательный документ"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/legal/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          acceptances: buyerRegistrationDocuments.map((document) => ({ slug: document.slug, version: document.version })),
          marketingAccepted: marketing,
          roleIntent,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(payload.error ?? "Не удалось завершить регистрацию"); return; }
      window.location.assign(roleIntent === "seller" ? "/seller" : returnTo === "/seller" ? "/account" : returnTo);
    } catch {
      setError("Связь прервалась. Проверьте интернет и повторите.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="registration-page">
    <header><a href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></a><a href={logoutHref}>Выйти</a></header>
    <section className="registration-shell">
      <div className="registration-intro"><span className="customer-kicker">Защищённая регистрация</span><h1>{roleIntent === "seller" ? "Подготовим кабинет вашего магазина" : "Один понятный шаг — и агент готов работать"}</h1><p>{roleIntent === "seller" ? "Сначала создаём единый аккаунт, затем вы заполните магазин, примете документы продавца и отправите его на проверку." : "Мы не прячем договоры в одной строке. Каждый обязательный документ подтверждается отдельно, а реклама не включается автоматически."}</p><div className="registration-person"><span>{name.slice(0, 1).toUpperCase()}</span><div><b>{name}</b><small>{email}</small></div><em>Личность подтверждена входом</em></div><ul><li>Один аккаунт для покупок и продаж</li><li>Продавец отвечает за товар и чек</li><li>Оплата идёт продавцу или банковскому партнёру</li><li>Каждая версия согласия сохраняется</li></ul></div>
      <form className="registration-consents" onSubmit={submit}>
        <fieldset className="registration-role-picker"><legend>Ваш основной сценарий</legend><div>
          <button type="button" aria-pressed={roleIntent === "buyer"} className={roleIntent === "buyer" ? "active" : ""} onClick={() => setRoleIntent("buyer")}><span>⌕</span><b>Покупатель</b><small>Сразу перейти к поиску и контролю покупок</small></button>
          <button type="button" aria-pressed={roleIntent === "seller"} className={roleIntent === "seller" ? "active" : ""} onClick={() => setRoleIntent("seller")}><span>◇</span><b>Продавец</b><small>После согласий настроить профиль магазина</small></button>
        </div><p>Режим можно менять в кабинете — повторная регистрация не понадобится.</p></fieldset>
        <div className="registration-progress"><span>{buyerRegistrationDocuments.filter((document) => checked[document.slug]).length} из {buyerRegistrationDocuments.length}</span><div><i style={{ width: `${buyerRegistrationDocuments.filter((document) => checked[document.slug]).length / buyerRegistrationDocuments.length * 100}%` }} /></div></div>
        <h2>Обязательные документы</h2><p>Откройте документы по ссылкам и подтвердите каждый отдельной галочкой.</p>
        <div className="registration-checklist">{buyerRegistrationDocuments.map((document) => <label key={document.slug} className={document.slug === "personal-data-consent" ? "separate-consent" : ""}>
          <input type="checkbox" checked={Boolean(checked[document.slug])} onChange={(event) => setChecked((current) => ({ ...current, [document.slug]: event.target.checked }))} />
          <span><b>{document.shortTitle}</b><small>{document.summary}</small><a href={`/legal/${document.slug}`} target="_blank" rel="noreferrer">Открыть документ · версия {document.version} ↗</a></span>
        </label>)}</div>
        <div className="registration-optional"><span>По желанию</span>{optionalRegistrationDocuments.map((document) => <label key={document.slug}><input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} /><span><b>{document.shortTitle}</b><small>{document.summary}</small><a href={`/legal/${document.slug}`} target="_blank" rel="noreferrer">Открыть согласие ↗</a></span></label>)}</div>
        {error && <div className="registration-error" role="alert">{error}</div>}
        <button className="registration-submit" disabled={!allRequired || busy}>{busy ? "Сохраняем согласия…" : roleIntent === "seller" ? "Продолжить к настройке магазина" : "Зарегистрироваться и продолжить"}</button>
        <small className="registration-proof">Будут сохранены аккаунт, версия каждого документа, дата и защищённый технический отпечаток. Галочки не проставлены заранее.</small>
      </form>
    </section>
  </main>;
}
