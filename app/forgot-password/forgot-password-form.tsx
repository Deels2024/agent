"use client";

import { FormEvent, useState } from "react";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const payload = await response.json() as { message?: string };
      setMessage(payload.message ?? "Проверьте почту.");
    } catch { setMessage("Не удалось отправить запрос. Повторите позже."); }
    finally { setBusy(false); }
  }
  return <form className="auth-card" onSubmit={submit}><div><span className="auth-eyebrow">Забыли пароль?</span><h2>Укажите email аккаунта</h2><p>Если адрес зарегистрирован, мы отправим одноразовую ссылку.</p></div><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>{message && <div className="auth-success" role="status">{message}</div>}<button className="auth-submit" disabled={busy}>{busy ? "Отправляем…" : "Получить ссылку"}</button></form>;
}
