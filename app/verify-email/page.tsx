import Link from "next/link";
import VerifyEmailForm from "./verify-email-form";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <main className="auth-page"><header className="auth-header"><Link href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></Link><Link href="/account">Личный кабинет</Link></header><section className="auth-shell auth-shell-compact"><div className="auth-benefits"><span className="customer-kicker">Подтверждение email</span><h1>Защитите свой аккаунт</h1><p>Подтверждённый адрес нужен для восстановления доступа и важных уведомлений о покупках.</p></div><VerifyEmailForm token={token} /></section></main>;
}
