"use client";

// 관리 화면 껍데기 — 왼쪽 사이드바 + 본문. 화면 넷(개요·퍼널·주문·후기)이 한 벌로 보이게 한다.
// 사이드바의 빨간 뱃지(입금 대기 건수)는 개요 화면이 채워 넣는다 — 여기서 또 API를 부르면
// 화면을 옮길 때마다 같은 요청이 두 번씩 나간다.
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/admin", ico: "◎", label: "개요" },
  { href: "/admin/funnel", ico: "◫", label: "퍼널 지표" },
  { href: "/admin/orders", ico: "◧", label: "주문", badge: "orders" },
  { href: "/admin/reviews", ico: "☆", label: "후기 검수", badge: "reviews" },
];

/** 개요 화면이 세어둔 "처리할 일" 건수. 화면을 옮겨도 사이드바에 그대로 남는다. */
const BADGE_KEY = "kb_admin_badges";

export type Badges = { orders?: number; reviews?: number };

export function saveBadges(b: Badges): void {
  try {
    sessionStorage.setItem(BADGE_KEY, JSON.stringify(b));
  } catch {
    /* 저장 못 해도 화면은 그대로 돈다 */
  }
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [badges, setBadges] = useState<Badges>({});

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BADGE_KEY);
      if (raw) setBadges(JSON.parse(raw) as Badges);
    } catch {
      /* 없으면 뱃지 없이 */
    }
  }, [path]);

  return (
    <div className="adm">
      <div className="adm-shell">
        <aside className="adm-side">
          <div className="adm-brand">
            <span className="dot" />
            <b>키즈북 관리</b>
          </div>
          <div className="adm-navlabel">화면</div>
          {NAV.map((n) => {
            const on = path === n.href;
            const count = n.badge ? (badges[n.badge as keyof Badges] ?? 0) : 0;
            return (
              <a key={n.href} href={n.href} className={`adm-nav${on ? " on" : ""}`}>
                <span className="adm-nav-ico">{n.ico}</span>
                {n.label}
                {count > 0 && <span className="tail">{count}</span>}
              </a>
            );
          })}
          <div className="adm-navlabel">바로가기</div>
          <a className="adm-nav" href="/" target="_blank" rel="noreferrer">
            <span className="adm-nav-ico">↗</span>
            손님 화면 열기
          </a>
          <div className="adm-side-foot">
            관리자 키는 이 브라우저에만 저장됩니다.
            <br />
            주소에 <code>?key=</code>를 달지 마세요.
          </div>
        </aside>
        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}
