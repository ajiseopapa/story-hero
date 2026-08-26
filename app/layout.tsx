import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { META_PIXEL_ID } from "@/lib/meta-pixel";
import { SITE_ORIGIN } from "@/lib/sharebook";
import "./globals.css";

// 방문자 분석용 측정 ID. 값이 비어 있으면 스크립트를 아예 넣지 않는다.
// GA_ID: 구글 애널리틱스 4 측정 ID (G-로 시작) — analytics.google.com에서 발급
// CLARITY_ID: 마이크로소프트 Clarity 프로젝트 ID — clarity.microsoft.com에서 발급
const GA_ID: string = "G-NN29TSN2W6";
const CLARITY_ID: string = "y4se3gcuvo";

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
      <body>
        {children}
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}');`}
            </Script>
          </>
        )}
        {CLARITY_ID && (
          <Script id="clarity-init" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_ID}");`}
          </Script>
        )}
        {/* 메타 광고 픽셀 — ID는 Vercel 환경변수(NEXT_PUBLIC_META_PIXEL_ID)로만 넣는다.
            비어 있으면 스크립트를 아예 넣지 않아 로컬·프리뷰 방문이 광고 데이터를 더럽히지 않는다.
            단계별 이벤트는 lib/meta-pixel.ts가 lib/track.ts에 붙어서 보낸다. */}
        {META_PIXEL_ID && (
          <>
            <Script id="meta-pixel-init" strategy="afterInteractive">
              {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '${META_PIXEL_ID}');
                fbq('track', 'PageView');`}
            </Script>
            <noscript>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                height="1"
                width="1"
                style={{ display: "none" }}
                alt=""
                src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
              />
            </noscript>
          </>
        )}
      </body>
    </html>
  );
}
