"use client";

/**
 * 인스타그램 인앱 브라우저 안내 (2026-09-23).
 *
 * 왜: 인스타 인앱으로 들어온 4명(iPhone 3 · Android 1)이 **사진 선택창을 한 번도 열지 못했다**
 * (photo:open 0). 이 웹뷰는 파일 선택을 막거나 곧바로 닫아버린다. 안내도 없이 막히면
 * 손님은 "이 사이트가 고장 났다"고 읽고 나간다.
 *
 * 무엇을: 안드로이드는 intent:// 로 크롬을 직접 연다. 아이폰은 인스타 웹뷰에서 Safari를
 * 여는 길이 막혀 있어(x-safari- 계열은 오래전에 죽었다) **주소를 복사해 붙여넣는** 길만
 * 남는다 — 되지도 않는 딥링크를 누르게 하지 않는다.
 *
 * ⭐ 넘겨주는 주소에는 쿠폰 코드(?c=)를 다시 붙인다. 쿠폰은 IndexedDB에 저장되는데 브라우저가
 *    바뀌면 그 저장소가 통째로 다른 곳이라, 주소에 싣지 않으면 밖에서 연 브라우저에는
 *    쿠폰이 없다. ?s=(유입 꼬리표)는 주소창에 그대로 남아 있으므로 그냥 따라간다.
 */
import { useEffect, useState } from "react";
import { deviceBucket, trackStep } from "@/lib/track";

/**
 * 이 안내를 띄울 브라우저인가.
 *
 * 인스타그램과 스레드만 — 둘은 **같은 메타 웹뷰**다(스레드 UA에도 Instagram이 들어 있어
 * lib/track.ts가 먼저 잡는 규칙 때문에 이름만 갈린다). 사진 선택창이 막히는 것도 같다.
 * 카톡·네이버 인앱은 기기별 퍼널에서 19~38%로 실제로 잘 넘어가므로 건드리지 않는다.
 */
function instagramInApp(ua: string): "ios" | "aos" | null {
  const bucket = deviceBucket(ua);
  if (bucket === "ios-insta" || bucket === "ios-threads") return "ios";
  if (bucket === "aos-insta" || bucket === "aos-threads") return "aos";
  return null;
}

/** 지금 주소에 쿠폰 코드를 다시 붙인 '밖에서 열 주소' */
function outsideUrl(coupon: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("c");
  const code = coupon.replace(/[^A-Za-z0-9]/g, "");
  if (code) url.searchParams.set("c", code);
  return url.toString();
}

export default function InAppNotice({ coupon = "" }: { coupon?: string }) {
  // 서버 렌더에는 UA가 없다 — 마운트 뒤에 켜야 하이드레이션이 어긋나지 않는다(hero-pc-note와 같은 규칙).
  const [plat, setPlat] = useState<"ios" | "aos" | null>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false); // 복사가 막힌 브라우저 — 주소를 눈으로 보고 옮기게 한다

  useEffect(() => {
    const p = instagramInApp(navigator.userAgent || "");
    setPlat(p);
    if (p) trackStep("inapp:notice");
  }, []);

  if (!plat) return null;

  const openOutside = async () => {
    const url = outsideUrl(coupon);
    if (plat === "aos") {
      trackStep("inapp:open");
      // 크롬으로 직접 넘긴다. 크롬이 없으면 fallback 주소로 기본 브라우저가 뜬다.
      const u = new URL(url);
      window.location.href =
        `intent://${u.host}${u.pathname}${u.search}` +
        `#Intent;scheme=https;package=com.android.chrome;` +
        `S.browser_fallback_url=${encodeURIComponent(url)};end`;
      return;
    }
    // 아이폰: 인스타 웹뷰에서 Safari를 여는 길이 없다 — 주소를 복사해 드린다.
    trackStep("inapp:copy");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setManual(true); // 클립보드가 막혔으면 주소를 그대로 보여준다
    }
  };

  return (
    <div className="inapp-note" role="note">
      <div className="ia-title">📷 사진을 올리려면 Safari 또는 Chrome에서 열어주세요.</div>
      <div className="ia-sub">
        인스타그램·스레드 앱 안에서는 사진 선택창이 열리지 않아요. 아래 버튼으로 밖에서 열면
        그대로 이어집니다.
      </div>
      <button type="button" className="btn ia-btn" onClick={openOutside}>
        {plat === "aos" ? "브라우저에서 열기" : copied ? "주소를 복사했어요 ✅" : "브라우저에서 열기"}
      </button>
      {plat === "ios" && copied && (
        <div className="ia-sub">
          Safari를 열고 주소창에 <b>길게 눌러 붙여넣기</b> 하시면 돼요.
          <br />
          또는 이 화면 오른쪽 위 <b>···</b> → <b>외부 브라우저에서 열기</b>를 눌러도 됩니다.
        </div>
      )}
      {plat === "ios" && manual && (
        <div className="ia-sub">
          주소를 직접 옮겨 적어주세요.
          <br />
          <code className="ia-url">{outsideUrl(coupon)}</code>
        </div>
      )}
    </div>
  );
}
