"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { kvSet } from "@/lib/store";

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
        const res = await fetch("/api/pay/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "결제 승인 실패");
        await kvSet("paidOrder", orderId);
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
