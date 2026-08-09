import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Агент покупок — выгодные и безопасные покупки",
  description: "Поиск лучших предложений по названию, фотографии и штрих-коду с итоговой ценой и проверкой продавца.",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className={geist.variable}>{children}</body></html>;
}
