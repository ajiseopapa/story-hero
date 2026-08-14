"use client";

// 관리 화면 목차. /admin 자체는 아무 데이터도 안 보여주고, 키를 받아 각 화면으로 넘겨주기만 한다.
// 키는 주소가 아니라 sessionStorage로 전달한다(useAdminKey) — 주소에 실으면
// 히스토리·Referer에 남는다. 예전 ?key= 즐겨찾기도 useAdminKey가 받아서 흡수한다.
import { useAdminKey } from "./use-admin-key";

const PAGES: { href: string; title: string; desc: string }[] = [
  {
    href: "/admin/funnel",
    title: "퍼널 지표",
    desc: "방문부터 결제까지 어느 단계에서 사람이 빠지는지",
  },
  {
    href: "/admin/orders",
    title: "계좌이체 주문",
    desc: "입금 확인을 누르면 주문자 화면이 바로 열림",
  },
  {
    href: "/admin/reviews",
    title: "후기 검수",
    desc: "손님이 남긴 후기를 공개·숨김·삭제",
  },
];

export default function AdminIndexPage() {
  const [key, setKey] = useAdminKey();

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">관리자 🔒</span>
        <h1>키즈북 관리 화면</h1>
        <p>관리자 키를 한 번 넣으면 아래 화면들이 그대로 열립니다.</p>
      </header>

      <section className="card">
        <div className="field">
          <label>관리자 키</label>
          <input
            type="password"
            value={key}
            placeholder="REVIEW_ADMIN_KEY 값"
            onChange={(e) => setKey(e.target.value.trim())}
          />
        </div>
        <p className="hint">
          키는 이 브라우저 탭이 열려 있는 동안만 기억합니다(탭을 닫으면 다시 넣어야 해요).
          <br />
          값은 프로젝트의 <b>.env.local</b> 파일이나 Vercel 환경변수{" "}
          <b>REVIEW_ADMIN_KEY</b>에 있습니다.
        </p>
      </section>

      <nav className="admin-menu">
        {PAGES.map((p) => (
          <a className="admin-item" href={p.href} key={p.href}>
            <b>{p.title}</b>
            <span>{p.desc}</span>
          </a>
        ))}
      </nav>
    </main>
  );
}
