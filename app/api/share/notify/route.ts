/**
 * 보관 링크 완성 알림 — 결제한 주문자의 이메일로 책 링크를 보내준다.
 *
 * 책이 브라우저에만 있으면 저장소가 지워질 때(사파리 7일 규칙 등) 복구가 안 된다.
 * 메일함에 링크가 남아 있으면 폰을 바꿔도 언제든 다시 열 수 있다.
 *
 * 검증: 주문 id+token이 실제 결제(paid)된 주문과 일치해야 하고, 링크 주소는
 * 클라이언트가 준 URL을 그대로 쓰지 않고 bookId로 서버가 다시 만든다(임의 링크 발송 방지).
 * 주문당 한 번만 보낸다(SET NX).
 */
import { pipeline } from "@/lib/kv";
import { sendMail } from "@/lib/mail";
import { ID_RE as ORDER_ID_RE, getOrder, tokenMatches } from "@/lib/orders";
import { ID_RE as BOOK_ID_RE, SITE_ORIGIN } from "@/lib/sharebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SENT_TTL = 180 * 24 * 60 * 60; // 주문 보관 기간과 동일

export async function POST(req: Request): Promise<Response> {
  let body: { order?: { id?: unknown; token?: unknown }; bookId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const orderId = typeof body.order?.id === "string" ? body.order.id : "";
  const orderToken = typeof body.order?.token === "string" ? body.order.token : "";
  const bookId = typeof body.bookId === "string" ? body.bookId : "";
  if (!ORDER_ID_RE.test(orderId) || !BOOK_ID_RE.test(bookId)) {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const order = await getOrder(orderId);
  if (!order || order.status !== "paid" || !tokenMatches(order.token, orderToken)) {
    return Response.json({ error: "주문 확인에 실패했어요." }, { status: 403 });
  }
  // 카드 결제 주문은 이메일이 없다 — 조용히 통과 (보낼 곳이 없을 뿐 오류가 아니다)
  if (!order.email) return Response.json({ ok: true, skipped: true });

  // 같은 주문으로 여러 번 링크를 만들어도 메일은 한 번만.
  // 표식은 발송 성공 뒤에 남긴다 — 발송이 실패했는데 표식만 남으면 다시는 못 보낸다.
  const sentKey = `kidsbook:order:${orderId}:linkmail`;
  const [already] = await pipeline([["GET", sentKey]]);
  if (already) return Response.json({ ok: true, skipped: true });

  try {
    await sendMail(
      order.email,
      `[키즈북] 동화책 보관 링크 — 《 ${order.bookTitle || "동화책"} 》`,
      [
        `${order.name}님, 동화책이 완성됐어요! 📖`,
        "",
        "아래 링크는 1년간 보관되는 우리 아이 동화책이에요.",
        "폰을 바꾸거나 브라우저 기록이 지워져도 이 링크로 언제든 다시 열 수 있으니,",
        "이 메일을 지우지 말고 보관해주세요. 가족에게 링크를 그대로 공유하셔도 됩니다.",
        "",
        `${SITE_ORIGIN}/book/${bookId}`,
        "",
        "궁금한 점은 이 메일에 답장 주시면 됩니다. 아이와 즐거운 밤 되세요 💛",
      ].join("\n"),
    );
  } catch (err) {
    console.error("share notify mail failed:", err);
    return Response.json({ error: "메일 발송에 실패했어요." }, { status: 500 });
  }

  await pipeline([["SET", sentKey, "1", "EX", SENT_TTL]]);
  return Response.json({ ok: true });
}
