import { consumeQuota, ipBucket } from "@/lib/limits";
import { NOTIFY_EMAIL, sendMail } from "@/lib/mail";
import { isStoreReady, newOrderId, newOrderToken, saveOrder, shortId } from "@/lib/orders";
import type { Order } from "@/lib/orders";
import { SITE_ORIGIN } from "@/lib/sharebook";
import { track } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRICE = Number(process.env.NEXT_PUBLIC_PRICE ?? "14900");
const ORDER_IP_DAILY_LIMIT = Number(process.env.ORDER_IP_DAILY_LIMIT ?? "5");
const ORDER_DAILY_LIMIT = Number(process.env.ORDER_DAILY_LIMIT ?? "200");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

/** 계좌이체 주문 접수. 입금 확인은 관리자가 수동으로 한다. */
export async function POST(req: Request): Promise<Response> {
  if (!isStoreReady()) {
    return Response.json(
      { error: "지금은 주문을 받을 수 없어요. 잠시 후 다시 시도해주세요." },
      { status: 503 },
    );
  }

  let body: { name?: unknown; email?: unknown; bookTitle?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const name = clean(body.name, 40);
  const email = clean(body.email, 120);
  const bookTitle = clean(body.bookTitle, 120);

  if (name.length < 1) {
    return Response.json({ error: "입금하실 분의 이름을 적어주세요." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "이메일 주소를 다시 확인해주세요." }, { status: 400 });
  }

  // 장난 주문으로 목록이 묻히지 않게 (전체 한도는 청구서가 아니라 관리 부담 상한)
  if (!(await consumeQuota(`order-${ipBucket(req)}`, ORDER_IP_DAILY_LIMIT))) {
    return Response.json(
      { error: "오늘은 주문을 더 넣을 수 없어요. 문의는 이메일로 부탁드려요." },
      { status: 429 },
    );
  }
  if (!(await consumeQuota("order-all", ORDER_DAILY_LIMIT))) {
    return Response.json(
      { error: "주문이 몰리고 있어요. 잠시 후 다시 시도해주세요." },
      { status: 429 },
    );
  }

  const order: Order = {
    id: newOrderId(),
    token: newOrderToken(),
    name,
    email,
    amount: PRICE,
    bookTitle,
    status: "pending",
    createdAt: Date.now(),
  };

  await saveOrder(order);

  // 통계 실패가 주문 접수를 되돌리면 안 된다
  try {
    await track(["order:submit"]);
  } catch {
    /* 조용히 실패 */
  }

  // 새 주문을 관리자에게 바로 알린다 — 관리 화면을 계속 들여다보지 않아도
  // 입금 확인이 늦지 않게. 발송 실패가 주문 접수를 되돌리면 안 된다.
  try {
    await sendMail(
      NOTIFY_EMAIL,
      `[키즈북] 새 주문 ${shortId(order.id)} — ${name} (${order.amount.toLocaleString()}원)`,
      [
        "새 계좌이체 주문이 들어왔어요.",
        "",
        `주문번호: ${shortId(order.id)}`,
        `입금자명: ${name}`,
        `이메일: ${email}`,
        `금액: ${order.amount.toLocaleString()}원`,
        ...(order.bookTitle ? [`책 제목: ${order.bookTitle}`] : []),
        "",
        `입금 확인하러 가기: ${SITE_ORIGIN}/admin/orders`,
      ].join("\n"),
    );
  } catch (err) {
    console.error("order notify mail failed:", err);
  }

  return Response.json({
    ok: true,
    id: order.id,
    token: order.token,
    orderNo: shortId(order.id),
  });
}
