import { adminEmails } from "../../lib/auth";
import { authSignOutPath, requireAuthenticatedUser } from "../chatgpt-auth";
import AdminDashboard from "./admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireAuthenticatedUser("/admin");
  const isAdmin = adminEmails().has(user.email.toLowerCase());

  if (!isAdmin) {
    return <main className="admin-access-denied">
      <section>
        <span>Щит безопасности</span>
        <div>!</div>
        <h1>Доступ только для администратора</h1>
        <p>Ваш вход подтверждён, но адрес не входит в список администраторов. Данные пользователей, заказов и продавцов не загружались.</p>
        <a href="/account">Вернуться в личный кабинет</a>
        <small>Если доступ нужен по работе, владелец проекта должен добавить адрес в защищённую настройку ADMIN_EMAILS.</small>
      </section>
    </main>;
  }

  return <AdminDashboard initialName={user.displayName} initialEmail={user.email} logoutHref={authSignOutPath(user.provider)} />;
}
