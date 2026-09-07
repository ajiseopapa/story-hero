import { createCoupon, getCoupon, randomCode } from "@/lib/coupons";
import { ID_RE, getOrder, setOrderReviewCoupon } from "@/lib/orders";
import { reviewRequestMail, type ReviewMailKind } from "@/lib/review-mail";
import { SITE_ORIGIN } from "@/lib/sharebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COUPON_DAYS = 30;

function authorized(req: Request): boolean {
  const key = process.env.ADMIN_KEY || process.env.REVIEW_ADMIN_KEY;
  if (!key) return false;
  return req.headers.get("x-admin-key") === key;
}

/**
 * 후기 요청 메일 만들기 — 답례 쿠폰(1회·30일)을 발급해 주문에 묶고, 메일 제목·본문을 채워 돌려준다.
 * 같은 주문에서 다시 누르면 이미 묶인 쿠폰을 그대로 쓴다(쿠폰이 두 장 나가지 않게).
 */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  let body: { id?: unknown; childName?: unknown; kind?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const { id } = body;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return Response.json({ error: "잘못된 주문번호예요." }, { status: 400 });
  }
  const childName = typeof body.childName === "string" ? body.childName.trim().slice(0, 20) : "";
  if (!childName) {
    return Response.json({ error: "아이 이름을 적어주세요." }, { status: 400 });
  }

  const order = await getOrder(id);
  if (!order) return Response.json({ error: "주문을 찾을 수 없어요." }, { status: 404 });

  // 손님이 두 갈래다 — 돈을 낸 사람과 무료 쿠폰으로 만든 사람. 안 넘어오면 금액으로 짐작한다.
  const kind: ReviewMailKind =
    body.kind === "paid" || body.kind === "coupon"
      ? body.kind
      : order.amount > 0
        ? "paid"
        : "coupon";

  // 답례 쿠폰은 산 사람에게만 — 쿠폰으로 만든 손님에게 또 쿠폰을 주지는 않는다.
  // (주문에 이미 묶인 쿠폰이 있어도 쿠폰 손님 메일에는 넣지 않는다.)
  let coupon = null as Awaited<ReturnType<typeof getCoupon>>;
  let reused = false;
  if (kind === "paid") {
    // 이미 묶인 쿠폰이 살아 있으면 재사용 — 같은 주문에서 두 장이 나가지 않게
    coupon = order.reviewCoupon ? await getCoupon(order.reviewCoupon) : null;
    reused = !!coupon;
    if (!coupon) {
      for (let i = 0; i < 5 && !coupon; i++) {
        coupon = await createCoupon({
          code: randomCode(),
          maxUses: 1,
          memo: `후기 답례 · ${order.name}`.slice(0, 60),
          expiresAt: Date.now() + COUPON_DAYS * 24 * 60 * 60 * 1000,
        });
      }
      if (!coupon) return Response.json({ error: "쿠폰을 만들지 못했어요." }, { status: 500 });
      await setOrderReviewCoupon(order.id, coupon.code);
    }
  }

  // 후기 전용 주소 — 주문 토큰이 들어가므로 이 메일을 받은 사람만 열 수 있다.
  const reviewUrl = `${SITE_ORIGIN}/review?o=${order.id}&t=${order.token}`;

  const mail = reviewRequestMail({
    childName,
    kind,
    code: coupon?.code,
    expiresAt: coupon?.expiresAt,
    reviewUrl,
  });

  return Response.json({
    ok: true,
    kind,
    reused,
    coupon: coupon ? { code: coupon.code, expiresAt: coupon.expiresAt } : null,
    to: order.email,
    reviewUrl,
    ...mail,
  });
}
