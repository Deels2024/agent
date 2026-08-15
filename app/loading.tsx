export default function Loading() {
  return <main className="system-page" aria-busy="true" aria-live="polite">
    <section className="system-loading">
      <div className="system-spinner" aria-hidden="true" />
      <h1>Загружаем сервис</h1>
      <p>Подготавливаем данные и проверяем доступ…</p>
      <div className="system-skeleton"><span /><span /><span /></div>
    </section>
  </main>;
}
