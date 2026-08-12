import { getOrder, tokenMatches } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 주문자 본인이 입금 확인 여부를 물어보는 곳.
 * id만으로는 열리지 않는다 — 주문할 때 받은 token이 맞아야 상태를 알려준다.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("token") ?? "";

  const order = await getOrder(id);
  // 없는 주문과 토큰 불일치를 같은 응답으로 — 주문 id를 넣어보며 캐낼 수 없게
  if (!order || !tokenMatches(order.token, token)) {
    return Response.json({ error: "주문을 찾을 수 없어요." }, { status: 404 });
  }

  return Response.json(
    { status: order.status, paidAt: order.paidAt ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
