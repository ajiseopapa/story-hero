import { NextRequest, NextResponse } from "next/server";
import { track } from "@/lib/stats";
import { isStoreReady, newOrderId, newOrderToken, saveOrder } from "@/lib/orders";
import type { Order } from "@/lib/orders";

export const runtime = "nodejs";
export const maxDuration = 30;

const PRICE = Number(process.env.NEXT_PUBLIC_PRICE ?? "14900");

// 토스페이먼츠 결제 승인. 클라이언트 successUrl로 돌아온 뒤 반드시 서버에서 승인해야 결제 완료.
export async function POST(req: NextRequest) {
  try {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json({ error: "결제 설정이 없습니다." }, { status: 500 });
    }

    const { paymentKey, orderId, amount } = (await req.json()) as {
      paymentKey?: string;
      orderId?: string;
      amount?: number;
    };
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
        const record: Order = {
          id: newOrderId(),
          token: newOrderToken(),
          name: "카드결제",
          email: "",
          amount: Number(amount),
          bookTitle: `(카드) ${data.orderName ?? orderId}`,
          status: "paid",
          createdAt: Date.now(),
          paidAt: Date.now(),
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
