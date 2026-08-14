import Link from "next/link";
import ForgotPasswordForm from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return <main className="auth-page"><header className="auth-header"><Link href="/" className="product-logo"><span className="product-logo-mark">✦</span><span>Агент покупок</span></Link><Link href="/login">Вернуться ко входу</Link></header><section className="auth-shell auth-shell-compact"><div className="auth-benefits"><span className="customer-kicker">Восстановление доступа</span><h1>Вернём доступ безопасно</h1><p>Ссылка действует один час и может быть использована только один раз.</p></div><ForgotPasswordForm /></section></main>;
}
