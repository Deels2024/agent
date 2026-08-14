import Link from "next/link";
import ResetPasswordForm from "./reset-password-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <main className="auth-page"><header className="auth-header"><Link href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></Link><Link href="/login">Войти</Link></header><section className="auth-shell auth-shell-compact"><div className="auth-benefits"><span className="customer-kicker">Новый пароль</span><h1>Создайте новый пароль</h1><p>После изменения все ранее открытые сеансы будут завершены.</p></div><ResetPasswordForm token={token} /></section></main>;
}
