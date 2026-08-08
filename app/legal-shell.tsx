// 약관/정책 페이지 공용 껍데기 (제목 + 본문 + 돌아가기)
import Link from "next/link";
import { BUSINESS } from "@/lib/business";

export default function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="wrap">
      <header className="hero" style={{ paddingTop: 24 }}>
        <h1 style={{ fontSize: 30 }}>{title}</h1>
        <p style={{ fontSize: 14 }}>
          {BUSINESS.service} · 최종 개정일 {updated}
        </p>
      </header>

      <section className="card legal">{children}</section>

      <div style={{ textAlign: "center", marginTop: 24 }}>
        <Link className="legal-back" href="/">
          ← 동화 만들러 돌아가기
        </Link>
      </div>
    </main>
  );
}
