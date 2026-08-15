"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="system-page">
    <section>
      <span className="system-code">Ошибка</span>
      <div className="system-mark warning">!</div>
      <h1>Не получилось открыть раздел</h1>
      <p>Данные не потеряны. Попробуйте ещё раз или вернитесь на главную страницу.</p>
      <div><button onClick={reset}>Повторить</button><Link className="secondary" href="/">На главную</Link></div>
    </section>
  </main>;
}
