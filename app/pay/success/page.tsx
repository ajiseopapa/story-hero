"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { kvGet, kvSet } from "@/lib/store";
import { metaTrack } from "@/lib/meta-pixel";
import { entrySource } from "@/lib/track";

// 결제 직전에 첫 화면이 초안에 남겨둔 구매자·유입 정보 — 필요한 부분만 읽는다(app/page.tsx의 Draft)
type DraftBits = {
  title?: string;
  buyer?: { name?: string; email?: string };
  entry?: { source?: string; referrer?: string };
};

function SuccessInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState("결제를 확인하고 있어요…");

  useEffect(() => {
    const paymentKey = params.get("paymentKey");
    const orderId = params.get("orderId");
    const amount = params.get("amount");
    if (!paymentKey || !orderId || !amount) {
      setMsg("결제 정보가 없습니다.");
      return;
    }
    (async () => {
      try {
        // 토스 승인 응답에는 이메일이 없다 — 결제 직전 초안에 적어둔 구매자·유입 정보를
        // 승인 요청에 같이 실어, 서버가 계좌이체 주문과 같은 모양의 기록을 남기게 한다.
        // 초안을 못 읽어도 승인은 진행한다(정보가 빈 주문이 승인 실패보다 낫다).
        const draft = await kvGet<DraftBits>("draft").catch(() => null);
        const entry = draft?.entry ?? entrySource();
        const res = await fetch("/api/pay/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentKey,
            orderId,
            amount: Number(amount),
            name: draft?.buyer?.name ?? "",
            email: draft?.buyer?.email ?? "",
            bookTitle: draft?.title ?? "",
            source: entry.source ?? "",
            referrer: entry.referrer ?? "",
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "결제 승인 실패");
        // 서버가 준 주문 자격 증명(id+token)을 저장하면 /api/image가 "돈 낸 주문"으로
        // 검증해준다. 없으면(기록 실패) 예전처럼 문자열 표식만 남긴다.
        await kvSet("paidOrder", json.bookOrder ?? orderId);
        // 카드 결제의 확정 전환 — 서버 승인(pay/confirm)이 성공한 뒤에만 보낸다
        metaTrack("Purchase", { value: Number(amount), currency: "KRW" });
        setMsg("결제 완료! 동화책으로 돌아갑니다…");
        router.replace("/?paid=1");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "결제 승인에 실패했습니다.");
      }
    })();
  }, [params, router]);

  return (
    <main className="wrap">
      <section className="card">
        <div className="progress-wrap">
          <div className="spinner" />
          <h2>{msg}</h2>
        </div>
      </section>
    </main>
  );
}

export default function PaySuccess() {
  return (
    <Suspense>
      <SuccessInner />
    </Suspense>
  );
}
