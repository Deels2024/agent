export function InternalAccessDenied() {
  return <main className="admin-access-denied">
    <section>
      <span>Служебный раздел</span>
      <div>!</div>
      <h1>Доступ только для команды проекта</h1>
      <p>Технические настройки, прототипы и состояние интеграций скрыты от покупателей и продавцов.</p>
      <a href="/account">Вернуться в личный кабинет</a>
    </section>
  </main>;
}
