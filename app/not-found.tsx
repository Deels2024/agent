import Link from "next/link";

export default function NotFound() {
  return <main className="system-page">
    <section>
      <span className="system-code">404</span>
      <div className="system-mark">⌕</div>
      <h1>Такой страницы нет</h1>
      <p>Возможно, адрес изменился или ссылка устарела. Вернитесь к поиску — ваши данные в безопасности.</p>
      <div><Link href="/">На главную</Link><Link className="secondary" href="/live-search">Найти товар</Link></div>
    </section>
  </main>;
}
