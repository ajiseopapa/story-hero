import { consumeQuota, ipBucket } from "@/lib/limits";
import { CODE_RE, normalizeCode, redeemCoupon } from "@/lib/coupons";
import { isStoreReady, newOrderId, newOrderToken, saveOrder, shortId } from "@/lib/orders";
import type { Order } from "@/lib/orders";
import { track } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 코드를 무차별로 넣어보는 것을 막는다. 정상 사용은 한 사람이 한두 번이다.
const COUPON_IP_DAILY_LIMIT = Number(process.env.COUPON_IP_DAILY_LIMIT ?? "10");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

/**
 * 손님이 쿠폰 코드를 쓰는 곳.
 *
 * 성공하면 0원짜리 '입금 확인된 주문'을 만들어 그 id·token을 돌려준다 —
 * 화면은 결제한 경우와 똑같은 길로 책을 연다(app/bank-order.tsx).
 */
export async function POST(req: Request): Promise<Response> {
  if (!isStoreReady()) {
    return Response.json(
      { error: "지금은 쿠폰을 쓸 수 없어요. 잠시 후 다시 시도해주세요." },
      { status: 503 },
    );
  }

  let body: { code?: unknown; bookTitle?: unknown; name?: unknown; email?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const code = normalizeCode(body.code);
  if (!CODE_RE.test(code)) {
    return Response.json({ error: "쿠폰 코드를 다시 확인해주세요." }, { status: 400 });
  }

  // 무료라도 이름·이메일은 받는다 — 누가 썼는지 남기고 안내를 보낼 수 있어야 한다(2026-09-02).
  // 쿠폰을 깎기 전에 검사해야 한다 — 뒤에서 튕기면 한 장이 그냥 사라진다.
  const name = clean(body.name, 40);
  const email = clean(body.email, 120);
  if (name.length < 1) {
    return Response.json({ error: "이름을 적어주세요." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "이메일 주소를 다시 확인해주세요." }, { status: 400 });
  }

  if (!(await consumeQuota(`coupon-${ipBucket(req)}`, COUPON_IP_DAILY_LIMIT))) {
    return Response.json(
      { error: "쿠폰 확인을 너무 많이 시도했어요. 내일 다시 시도해주세요." },
      { status: 429 },
    );
  }

  const result = await redeemCoupon(code);
  if (!result.ok) {
    // 없는 코드와 다 쓴 코드를 구별해 알려준다 — 손님이 뭘 해야 할지 달라진다
    const message =
      result.reason === "expired"
        ? "기간이 지난 쿠폰이에요."
        : result.reason === "used"
          ? "이미 모두 사용된 쿠폰이에요."
          : "그런 쿠폰이 없어요. 코드를 다시 확인해주세요.";
    return Response.json({ error: message }, { status: 404 });
  }

  const bookTitle = typeof body.bookTitle === "string" ? body.bookTitle.trim().slice(0, 120) : "";
  const order: Order = {
    id: newOrderId(),
    token: newOrderToken(),
    name,
    email,
    amount: 0, // 매출과 섞이지 않게 0원으로 남긴다
    bookTitle,
    status: "paid",
    createdAt: Date.now(),
    paidAt: Date.now(),
    memo: `무료 쿠폰 ${code} (${result.coupon.used}/${result.coupon.maxUses})`,
  };
  await saveOrder(order);

  try {
    await track(["coupon:use"]);
  } catch {
    /* 통계 실패가 쿠폰 사용을 되돌리면 안 된다 */
  }

  return Response.json({ ok: true, id: order.id, token: order.token, orderNo: shortId(order.id) });
}
