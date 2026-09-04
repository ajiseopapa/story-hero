import {
  CODE_RE,
  createCoupon,
  deleteCoupon,
  listCoupons,
  normalizeCode,
  randomCode,
  updateCoupon,
} from "@/lib/coupons";
import type { CouponPatch } from "@/lib/coupons";

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

/**
 * 쿠폰 고치기 — 횟수·메모·만료일.
 * 만료일은 "YYYY-MM-DD"로 받아 그날 한국시간 자정 직전까지로 잡는다. 빈 문자열이면 무기한.
 */
export async function PATCH(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  let body: { code?: unknown; maxUses?: unknown; memo?: unknown; expiresOn?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const code = normalizeCode(body.code);
  if (!CODE_RE.test(code)) {
    return Response.json({ error: "쿠폰을 찾을 수 없어요." }, { status: 404 });
  }

  const patch: CouponPatch = {};
  if (body.maxUses !== undefined) {
    const n = Number(body.maxUses);
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      return Response.json({ error: "사용 횟수는 1~1000 사이로 적어주세요." }, { status: 400 });
    }
    patch.maxUses = n;
  }
  if (body.memo !== undefined) {
    patch.memo = typeof body.memo === "string" ? body.memo : null;
  }
  if (body.expiresOn !== undefined) {
    const on = typeof body.expiresOn === "string" ? body.expiresOn.trim() : "";
    if (!on) {
      patch.expiresAt = null;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) {
        return Response.json({ error: "만료일 형식이 올바르지 않아요." }, { status: 400 });
      }
      const at = Date.parse(`${on}T23:59:59.999+09:00`);
      if (!Number.isFinite(at)) {
        return Response.json({ error: "만료일이 올바르지 않아요." }, { status: 400 });
      }
      patch.expiresAt = at;
    }
  }

  const coupon = await updateCoupon(code, patch);
  if (!coupon) {
    return Response.json({ error: "쿠폰을 찾을 수 없어요." }, { status: 404 });
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
