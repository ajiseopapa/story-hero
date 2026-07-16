"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function FailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const message = params.get("message") || "결제가 취소되었거나 실패했습니다.";

  return (
    <main className="wrap">
      <section className="card" style={{ textAlign: "center" }}>
        <h2 style={{ fontFamily: "var(--hand)", fontSize: 24 }}>결제 실패 😢</h2>
        <p style={{ color: "var(--ink-soft)", lineHeight: 1.7 }}>{message}</p>
        <button className="btn" onClick={() => router.replace("/?resume=1")}>
          동화책으로 돌아가기
        </button>
      </section>
    </main>
  );
}

export default function PayFail() {
  return (
    <Suspense>
      <FailInner />
    </Suspense>
  );
}
