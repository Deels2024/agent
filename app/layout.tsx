import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Агент покупок — выгодные и безопасные покупки",
  description: "Поиск лучших предложений по названию, фотографии и штрих-коду с итоговой ценой и проверкой продавца.",
  icons: { icon: "/favicon.svg" },
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
