"use client";

import { useState } from "react";

export default function VerifyEmailForm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  async function verify() {
    if (!token) { setState("error"); setMessage("В ссылке отсутствует код подтверждения"); return; }
    setState("busy");
    try {
      const response = await fetch("/api/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setState("error"); setMessage(payload.error ?? "Не удалось подтвердить адрес"); }
      else { setState("done"); setMessage("Email подтверждён. Аккаунт полностью защищён."); }
    } catch { setState("error"); setMessage("Связь прервалась. Повторите позже."); }
  }
  return <section className="auth-card"><div><span className="auth-eyebrow">Один шаг</span><h2>Подтвердить адрес</h2><p>Кнопка применит одноразовую ссылку. Повторно использовать её нельзя.</p></div>{message && <div className={state === "done" ? "auth-success" : "auth-error"} role="status">{message}</div>}{state === "done" ? <a className="auth-submit auth-submit-link" href="/account">Открыть личный кабинет</a> : <button className="auth-submit" disabled={state === "busy"} onClick={() => void verify()}>{state === "busy" ? "Подтверждаем…" : "Подтвердить email"}</button>}</section>;
}
