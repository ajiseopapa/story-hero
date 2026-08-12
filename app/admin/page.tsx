"use client";

// 관리 화면 목차. /admin 자체는 아무 데이터도 안 보여주고, 키를 받아 각 화면으로 넘겨주기만 한다.
// (예전엔 /admin/funnel · /admin/reviews 주소를 외우고 있어야 했다)
import { useEffect, useState } from "react";

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
  const [key, setKey] = useState("");

  // 다른 관리 화면에서 ?key=... 를 달고 돌아온 경우 그대로 이어 쓴다
  useEffect(() => {
    setKey(new URLSearchParams(window.location.search).get("key") ?? "");
  }, []);

  const link = (href: string) => (key ? `${href}?key=${encodeURIComponent(key)}` : href);

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">관리자 🔒</span>
        <h1>키즈북 관리 화면</h1>
        <p>관리자 키를 넣으면 아래 화면들이 키를 달고 열립니다.</p>
      </header>

      <section className="card">
        <div className="field">
          <label>관리자 키</label>
          <input
            type="password"
            value={key}
            placeholder="Vercel 환경변수 ADMIN_KEY 값"
            onChange={(e) => setKey(e.target.value.trim())}
          />
        </div>
        <p className="hint">
          키는 저장하지 않습니다. 이 화면을 벗어나면 다시 넣어야 합니다.
        </p>
      </section>

      {PAGES.map((p) => (
        <section className="card" key={p.href}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            <a href={link(p.href)}>{p.title}</a>
          </h2>
          <p className="hint" style={{ marginTop: 4 }}>
            {p.desc}
          </p>
        </section>
      ))}
    </main>
  );
}
