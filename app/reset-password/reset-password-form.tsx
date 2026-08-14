"use client";

import { FormEvent, useState } from "react";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (!token) { setError("В ссылке отсутствует код восстановления"); return; }
    if (password !== confirmation) { setError("Пароли не совпадают"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) setError(payload.error ?? "Не удалось изменить пароль");
      else setMessage("Пароль изменён. Теперь можно войти в аккаунт.");
    } catch { setError("Связь прервалась. Повторите позже."); }
    finally { setBusy(false); }
  }
  return <form className="auth-card" onSubmit={submit}><div><span className="auth-eyebrow">Защита аккаунта</span><h2>Новый пароль</h2><p>Минимум 10 символов, одна буква и одна цифра.</p></div><label>Новый пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required /></label><label>Повторите пароль<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required /></label>{error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-success" role="status">{message} <a href="/login">Перейти ко входу</a></div>}<button className="auth-submit" disabled={busy || Boolean(message)}>{busy ? "Сохраняем…" : "Изменить пароль"}</button></form>;
}
