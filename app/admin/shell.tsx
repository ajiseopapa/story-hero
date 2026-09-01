"use client";

// 관리 화면 껍데기 — 왼쪽 사이드바 + 본문. 화면 넷(개요·퍼널·주문·후기)이 한 벌로 보이게 한다.
// 사이드바의 뱃지(처리할 일 건수)는 각 화면이 자기 목록을 불러올 때 채워 넣는다 — 여기서 또
// API를 부르면 화면을 옮길 때마다 같은 요청이 두 번씩 나간다.
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/admin", ico: "◎", label: "개요" },
  { href: "/admin/funnel", ico: "◫", label: "퍼널 지표" },
  { href: "/admin/orders", ico: "◧", label: "주문", badge: "orders" },
  { href: "/admin/reviews", ico: "☆", label: "후기 검수", badge: "reviews" },
];

/** 각 화면이 세어둔 "처리할 일" 건수. 화면을 옮겨도 사이드바에 그대로 남는다. */
const BADGE_KEY = "kb_admin_badges";
/** 같은 탭 안에서는 storage 이벤트가 안 오므로, 저장할 때 직접 알린다. */
const BADGE_EVENT = "kb-admin-badges";

export type Badges = { orders?: number; reviews?: number };

export function readBadges(): Badges {
  try {
    const raw = sessionStorage.getItem(BADGE_KEY);
    return raw ? (JSON.parse(raw) as Badges) : {};
  } catch {
    return {};
  }
}

export function saveBadges(b: Badges): void {
  try {
    sessionStorage.setItem(BADGE_KEY, JSON.stringify(b));
  } catch {
    /* 저장 못 해도 화면은 그대로 돈다 */
  }
  // 지금 열려 있는 사이드바도 바로 갱신한다 — 주문을 처리했는데 뱃지만 남아 있으면
  // 처리할 일이 있는 줄 알고 다시 들어오게 된다.
  try {
    window.dispatchEvent(new CustomEvent(BADGE_EVENT));
  } catch {
    /* 이벤트를 못 보내도 다음 화면 이동 때 다시 읽는다 */
  }
}

/** 한 화면은 자기 몫만 안다 — 나머지 숫자는 건드리지 않고 덮어쓴다. */
export function updateBadges(part: Badges): void {
  saveBadges({ ...readBadges(), ...part });
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [badges, setBadges] = useState<Badges>({});

  useEffect(() => {
    const sync = () => setBadges(readBadges());
    sync();
    window.addEventListener(BADGE_EVENT, sync);
    return () => window.removeEventListener(BADGE_EVENT, sync);
  }, [path]);

  return (
    <div className="adm">
      <div className="adm-shell">
        <aside className="adm-side">
          <div className="adm-brand">
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
