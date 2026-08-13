import type { Metadata, Viewport } from "next";
import { SITE_ORIGIN } from "@/lib/sharebook";
import "./globals.css";

const DESCRIPTION =
  "아이 이름과 사진을 넣으면, 우리 아이를 닮은 얼굴로 그린 표지 포함 11페이지 그림동화책을 만들어드려요. 사실적 그림·수채화·색연필·크레파스 중에 고를 수 있어요.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN), // opengraph-image의 절대 주소 생성에 필요
  title: "키즈북 · 우리 아이가 주인공인 동화책",
  description: DESCRIPTION,
  // 같은 앱이 *.vercel.app 주소로도 열리므로, 검색엔진에는 항상 본 도메인이 원본임을 알린다.
  // "./"는 각 경로에서 자기 자신(본 도메인 기준)으로 풀린다.
  alternates: { canonical: "./" },
  // 네이버 서치어드바이저 소유확인용 (2026-08-13)
  verification: {
    other: { "naver-site-verification": "4f3c416184454e3d625b6d90145ce31a4fcdea50" },
  },
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
  // maximumScale은 두지 않는다 — 글자가 작아 보일 때 손가락으로 확대할 수 있어야 한다
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
        {/* 글꼴 2종만 쓴다 — 제목·동화 본문은 고운바탕(따뜻한 바탕체), UI는 Pretendard(고딕).
            예전엔 손글씨·명조·고딕 3종이 한 화면에 섞여 통일감이 없었다 (2026-08-12). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
