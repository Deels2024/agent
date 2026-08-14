import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Агент покупок — выгодные и безопасные покупки",
  description: "Поиск лучших предложений по названию, фотографии и штрих-коду с итоговой ценой и проверкой продавца.",
  icons: { icon: "/favicon.svg" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Агент покупок — найдём выгоднее и проверим продавца",
    description: "Сравнение точной модели, итоговой цены, доставки, гарантии и надёжности продавца.",
    type: "website",
    locale: "ru_RU",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
