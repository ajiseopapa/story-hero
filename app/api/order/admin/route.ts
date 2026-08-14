import { sendMail } from "@/lib/mail";
import { ID_RE, listOrders, setOrderStatus } from "@/lib/orders";
import { SITE_ORIGIN } from "@/lib/sharebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 후기 검수·퍼널과 같은 키를 쓴다.
// 쿼리스트링(?key=)은 받지 않는다 — 액세스 로그·브라우저 히스토리·Referer에 남아 유출된다.
function authorized(req: Request): boolean {
  const key = process.env.ADMIN_KEY || process.env.REVIEW_ADMIN_KEY;
  if (!key) return false; // 키를 설정하기 전에는 잠가둔다
  return req.headers.get("x-admin-key") === key;
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

  // 입금 확인 즉시 주문자에게 안내 — 주문 화면에서 "확인되면 이메일로 알려드릴게요"라고
  // 약속한 메일이 바로 이것이다. 발송 실패가 상태 변경을 되돌리면 안 된다.
  if (action === "paid" && updated.email) {
    try {
      await sendMail(
        updated.email,
        `[키즈북] 입금이 확인됐어요 — 《 ${updated.bookTitle || "동화책"} 》`,
        [
          `${updated.name}님, 입금 확인이 끝났어요. 감사합니다! 🎉`,
          "",
          "동화를 만들던 폰(브라우저)으로 키즈북에 다시 들어가시면 전체 책이 열립니다.",
          "주문 창을 열어둔 채라면 잠시 뒤 자동으로 열려요.",
          "",
          `키즈북 열기: ${SITE_ORIGIN}`,
          "",
          "책이 완성되면 1년간 언제든 다시 열 수 있는 보관 링크도 이 주소로 보내드릴게요.",
          "궁금한 점은 이 메일에 답장 주시면 됩니다.",
        ].join("\n"),
      );
    } catch (err) {
      console.error("paid notify mail failed:", err);
    }
  }

  return Response.json({ ok: true, order: updated });
}
