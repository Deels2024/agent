"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type Mode = "login" | "register";

export default function LoginForm({ returnTo, initialMode }: { returnTo: string; initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [verificationNeeded, setVerificationNeeded] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "register" && password !== confirmation) { setError("Пароли не совпадают"); return; }
    setBusy(true); setError(""); setInfo(""); setVerificationNeeded(false);
    try {
      const response = await fetch(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const payload = await response.json() as { error?: string; code?: string };
      if (!response.ok) { setError(payload.error ?? "Не удалось выполнить вход"); setVerificationNeeded(payload.code === "email_verification_required"); return; }
      const destination = mode === "register" ? `/register?return_to=${encodeURIComponent(returnTo)}` : returnTo;
      window.location.assign(destination);
    } catch {
      setError("Нет связи с сервером. Проверьте интернет и повторите.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next); setError(""); setInfo(""); setVerificationNeeded(false); setPassword(""); setConfirmation("");
  }

  async function resendVerification() {
    setBusy(true); setInfo("");
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const payload = await response.json() as { message?: string; error?: string };
      setInfo(payload.message ?? payload.error ?? "Проверьте почту.");
    } catch { setInfo("Не удалось отправить письмо. Повторите позже."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page">
    <header className="auth-header"><Link href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></Link><Link href="/">На главную</Link></header>
    <section className="auth-shell">
      <div className="auth-benefits">
        <span className="customer-kicker">Личный кабинет</span>
        <h1>Выгодные покупки под вашим контролем</h1>
        <p>История поиска, контроль цены, предложения магазинов, заказы и помощь после покупки — в одном месте.</p>
        <ul><li>Цены и найденные предложения сохраняются</li><li>Продавцы и условия сделки проверяются</li><li>Пароль хранится только в защищённом виде</li><li>Сеанс можно завершить на любом устройстве</li></ul>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-tabs" role="tablist"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Вход</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Регистрация</button></div>
        <div><span className="auth-eyebrow">{mode === "login" ? "С возвращением" : "Новый аккаунт"}</span><h2>{mode === "login" ? "Войти в кабинет" : "Создать личный кабинет"}</h2><p>{mode === "login" ? "Используйте email и пароль, указанные при регистрации." : "После создания аккаунта подтвердите обязательные документы."}</p></div>
        {mode === "register" && <label>Имя<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" minLength={2} maxLength={80} placeholder="Сергей" required /></label>}
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} placeholder="name@example.ru" required /></label>
        <label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} maxLength={128} placeholder="Минимум 10 символов" required /></label>
        {mode === "login" && <Link className="auth-forgot-link" href="/forgot-password">Забыли пароль?</Link>}
        {mode === "register" && <><label>Повторите пароль<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required /></label><small className="auth-password-hint">Используйте минимум одну букву и одну цифру.</small></>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        {verificationNeeded && <button type="button" className="auth-resend-button" disabled={busy} onClick={() => void resendVerification()}>Отправить письмо подтверждения повторно</button>}
        {info && <div className="auth-success" role="status">{info}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}</button>
        <small className="auth-security">Защищённая HttpOnly-сессия · пароль хешируется PBKDF2 · данные не передаются ChatGPT</small>
      </form>
    </section>
  </main>;
}
