import { ID_RE, listOrders, setOrderStatus } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 후기 검수·퍼널과 같은 키를 쓴다.
function authorized(req: Request): boolean {
  const key = process.env.ADMIN_KEY || process.env.REVIEW_ADMIN_KEY;
  if (!key) return false; // 키를 설정하기 전에는 잠가둔다
  const url = new URL(req.url);
  return url.searchParams.get("key") === key || req.headers.get("x-admin-key") === key;
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const orders = await listOrders();
  return Response.json({ orders }, { headers: { "cache-control": "no-store" } });
}

/** 입금 확인 / 취소 처리 */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  let body: { id?: unknown; action?: unknown; memo?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const { id, action } = body;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return Response.json({ error: "잘못된 주문번호예요." }, { status: 400 });
  }
  if (action !== "paid" && action !== "canceled" && action !== "pending") {
    return Response.json({ error: "알 수 없는 동작이에요." }, { status: 400 });
  }

  const memo = typeof body.memo === "string" ? body.memo.slice(0, 200) : undefined;
  const updated = await setOrderStatus(id, action, memo);
  if (!updated) return Response.json({ error: "주문을 찾을 수 없어요." }, { status: 404 });

  return Response.json({ ok: true, order: updated });
}
