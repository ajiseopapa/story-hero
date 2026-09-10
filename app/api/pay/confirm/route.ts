import { NextRequest, NextResponse } from "next/server";
import { track } from "@/lib/stats";
import { isStoreReady, newOrderId, newOrderToken, saveOrder } from "@/lib/orders";
import type { Order } from "@/lib/orders";

export const runtime = "nodejs";
export const maxDuration = 30;

const PRICE = Number(process.env.NEXT_PUBLIC_PRICE ?? "14900");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 구매자 정보 정리 — 계좌이체 주문(/api/order)과 같은 규칙으로 깎는다 */
function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

/** 유입 꼬리표·호스트처럼 정해진 글자만 남기는 값 정리 */
function tag(v: unknown, drop: RegExp, max: number): string {
  return typeof v === "string" ? v.toLowerCase().replace(drop, "").slice(0, max) : "";
}

// 토스페이먼츠 결제 승인. 클라이언트 successUrl로 돌아온 뒤 반드시 서버에서 승인해야 결제 완료.
export async function POST(req: NextRequest) {
  try {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json({ error: "결제 설정이 없습니다." }, { status: 500 });
    }

    const body = (await req.json()) as {
      paymentKey?: string;
      orderId?: string;
      amount?: number;
      // 결제 직전 초안에 적어둔 구매자·유입 정보(/pay/success가 실어 보낸다).
      // 토스 승인 응답에는 이메일이 없어 여기서 받아야 계좌이체 주문과 같은 기록이 남는다(2026-09-10).
      name?: unknown;
      email?: unknown;
      bookTitle?: unknown;
      source?: unknown;
      referrer?: unknown;
    };
    const { paymentKey, orderId, amount } = body;
    if (!paymentKey || !orderId || !amount) {
      return NextResponse.json({ error: "결제 정보가 부족합니다." }, { status: 400 });
    }
    // 금액 위변조 방지: 정가와 다르면 승인하지 않음
    if (Number(amount) !== PRICE) {
      return NextResponse.json({ error: "결제 금액이 올바르지 않습니다." }, { status: 400 });
    }

    const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.message ?? "결제 승인에 실패했습니다." },
        { status: res.status },
      );
    }

    // 실매출은 서버에서 센다 — 클라이언트가 리다이렉트 도중 죽어도 기록이 남아야 한다.
    // 통계 실패가 결제 승인을 되돌리는 일은 없어야 하므로 오류는 삼킨다.
    try {
      await track(["pay:done"]);
    } catch {
      /* 통계는 조용히 실패한다 */
    }

    // 결제와 삽화 생성을 서버에서 잇는 주문 기록 — /api/image가 이 토큰으로
    // "돈 낸 주문"임을 확인한다. 기록 실패가 결제 승인을 되돌리면 안 되므로 오류는 삼키고,
    // 그 경우 클라이언트는 토큰 없이(무료 IP 한도로) 이어 그리게 된다.
    let bookOrder: { id: string; token: string } | undefined;
    try {
      if (isStoreReady()) {
        // 구매자 정보는 있으면 쓰고 없으면 예전 표식으로 남긴다 — 승인은 이미 끝났으니 여기서 막지 않는다
        const name = clean(body.name, 40) || "카드결제";
        const emailRaw = clean(body.email, 120);
        const email = EMAIL_RE.test(emailRaw) ? emailRaw : "";
        const bookTitle = clean(body.bookTitle, 120) || data.orderName || orderId;
        const source = tag(body.source, /[^a-z0-9-]/g, 16);
        const referrer = tag(body.referrer, /[^a-z0-9.-]/g, 40);
        const record: Order = {
          id: newOrderId(),
          token: newOrderToken(),
          name,
          email,
          amount: Number(amount),
          // "(카드)" 접두어로 관리 화면에서 계좌이체와 구분한다
          bookTitle: `(카드) ${bookTitle}`,
          status: "paid",
          createdAt: Date.now(),
          paidAt: Date.now(),
          ...(source ? { source } : {}),
          ...(referrer ? { referrer } : {}),
        };
        await saveOrder(record);
        bookOrder = { id: record.id, token: record.token };
      }
    } catch {
      /* 주문 기록은 조용히 실패한다 */
    }

    return NextResponse.json({
      ok: true,
      orderId: data.orderId,
      approvedAt: data.approvedAt,
      bookOrder,
    });
  } catch {
    return NextResponse.json({ error: "결제 승인 중 오류가 발생했습니다." }, { status: 500 });
  }
}
