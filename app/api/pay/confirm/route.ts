import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const PRICE = Number(process.env.NEXT_PUBLIC_PRICE ?? "12900");

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

    return NextResponse.json({
      ok: true,
      orderId: data.orderId,
      approvedAt: data.approvedAt,
    });
  } catch {
    return NextResponse.json({ error: "결제 승인 중 오류가 발생했습니다." }, { status: 500 });
  }
}
