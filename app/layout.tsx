import type { Metadata, Viewport } from "next";
import { SITE_ORIGIN } from "@/lib/sharebook";
import "./globals.css";

const DESCRIPTION =
  "아이 이름과 사진을 넣으면, 우리 아이가 수채화 동화책의 주인공이 되는 그림동화를 만들어드려요.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN), // opengraph-image의 절대 주소 생성에 필요
  title: "키즈북 · 우리 아이가 주인공인 동화책",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "키즈북",
    url: SITE_ORIGIN,
    title: "키즈북 · 우리 아이가 주인공인 동화책",
    description: DESCRIPTION,
    locale: "ko_KR",
  },
  twitter: {
    card: "summary_large_image",
    title: "키즈북 · 우리 아이가 주인공인 동화책",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f7efe2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&family=Gowun+Dodum&family=Nanum+Myeongjo:wght@400;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
