import type { Metadata } from "next";
import AdminShell from "./shell";
import "./admin.css";

/**
 * 관리 화면은 검색엔진에 절대 올라가면 안 된다.
 *
 * robots.txt의 Disallow는 "크롤하지 마라"일 뿐이라, 어디서든 링크가 걸리면
 * 구글이 내용 없이 주소만 색인해 검색결과에 노출할 수 있다. noindex는 그걸 막는다.
 * 둘 다 걸어두는 게 맞다.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
