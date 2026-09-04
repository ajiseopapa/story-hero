import { createCoupon, getCoupon, randomCode } from "@/lib/coupons";
import { ID_RE, getOrder, setOrderReviewCoupon } from "@/lib/orders";
import { reviewRequestMail, type Honorific } from "@/lib/review-mail";

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

  let body: { id?: unknown; childName?: unknown; honorific?: unknown; firstCustomer?: unknown };
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
  const honorific: Honorific = body.honorific === "아버님" ? "아버님" : "어머님";
  const firstCustomer = body.firstCustomer === true;

  const order = await getOrder(id);
  if (!order) return Response.json({ error: "주문을 찾을 수 없어요." }, { status: 404 });

  // 이미 묶인 쿠폰이 살아 있으면 재사용
  let coupon = order.reviewCoupon ? await getCoupon(order.reviewCoupon) : null;
  let reused = !!coupon;
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
    reused = false;
  }

  const mail = reviewRequestMail({
    childName,
    honorific,
    firstCustomer,
    code: coupon.code,
    expiresAt: coupon.expiresAt,
  });

  return Response.json({
    ok: true,
    reused,
    coupon: { code: coupon.code, expiresAt: coupon.expiresAt },
    to: order.email,
    ...mail,
  });
}
