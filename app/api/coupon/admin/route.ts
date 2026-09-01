import {
  CODE_RE,
  createCoupon,
  deleteCoupon,
  listCoupons,
  normalizeCode,
  randomCode,
} from "@/lib/coupons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 다른 관리 화면과 같은 키. 쿼리스트링으로는 받지 않는다(로그·Referer에 남는다).
function authorized(req: Request): boolean {
  const key = process.env.ADMIN_KEY || process.env.REVIEW_ADMIN_KEY;
  if (!key) return false;
  return req.headers.get("x-admin-key") === key;
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(
    { coupons: await listCoupons() },
    { headers: { "cache-control": "no-store" } },
  );
}

/** 쿠폰 발급. code를 비우면 헷갈리는 글자를 뺀 코드를 만들어준다. */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  let body: { code?: unknown; maxUses?: unknown; memo?: unknown; days?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const code = body.code ? normalizeCode(body.code) : randomCode();
  if (!CODE_RE.test(code)) {
    return Response.json({ error: "코드는 영문·숫자 4~20자로 지어주세요." }, { status: 400 });
  }

  const days = Number(body.days);
  const coupon = await createCoupon({
    code,
    maxUses: Number(body.maxUses) || 1,
    memo: typeof body.memo === "string" ? body.memo.trim().slice(0, 60) : undefined,
    expiresAt: Number.isFinite(days) && days > 0 ? Date.now() + days * 24 * 60 * 60 * 1000 : undefined,
  });
  if (!coupon) {
    return Response.json({ error: "이미 있는 코드예요. 다른 코드로 만들어주세요." }, { status: 409 });
  }
  return Response.json({ ok: true, coupon });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const code = normalizeCode(new URL(req.url).searchParams.get("code"));
  if (!(await deleteCoupon(code))) {
    return Response.json({ error: "쿠폰을 찾을 수 없어요." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
