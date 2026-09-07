// 후기 전용 주소(/review?o=..&t=..)가 폼을 그리기 전에 주문을 확인하는 곳.
// 메일로 받은 링크는 손님이 어느 기기에서 열지 모른다 — 책이 그 브라우저에 없어도
// 주문번호+토큰만으로 "누구의 어떤 책"인지 알 수 있어야 후기 폼을 띄울 수 있다.
import { ID_RE, getOrder, tokenMatches } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("o") ?? "";
  const token = url.searchParams.get("t") ?? "";

  // 없는 주문과 토큰 불일치는 같은 응답으로 — 주문번호를 넣어보며 캐낼 수 없게
  const order = ID_RE.test(id) ? await getOrder(id) : null;
  if (!order || !tokenMatches(order.token, token)) {
    return Response.json({ error: "주문을 찾을 수 없어요." }, { status: 404 });
  }
  if (order.status !== "paid") {
    return Response.json(
      {
        error:
          order.status === "canceled"
            ? "취소된 주문이에요. 문의는 이 메일로 답장해 주세요."
            : "아직 입금이 확인되지 않은 주문이에요.",
      },
      { status: 403 },
    );
  }

  return Response.json(
    { bookTitle: order.bookTitle },
    { headers: { "cache-control": "no-store" } },
  );
}
