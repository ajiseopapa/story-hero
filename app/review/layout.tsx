import type { Metadata } from "next";

// 주문번호가 들어간 개인 링크다 — 검색에 걸릴 이유가 없다(/book/{id}와 같은 원칙).
export const metadata: Metadata = {
  title: "후기 남기기 · 키즈북",
  robots: { index: false, follow: false },
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
