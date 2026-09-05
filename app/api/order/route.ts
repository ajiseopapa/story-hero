import { consumeQuota, ipBucket } from "@/lib/limits";
import { mailAdminNewOrder, mailOrderReceived } from "@/lib/mail";
import {
  isStoreReady,
  newOrderId,
  newOrderToken,
  payDeadline,
  saveOrder,
  shortId,
} from "@/lib/orders";
import type { Order } from "@/lib/orders";
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

/** 유입 꼬리표·호스트처럼 정해진 글자만 남기는 값 정리 */
function tag(v: unknown, drop: RegExp, max: number): string {
  return typeof v === "string" ? v.toLowerCase().replace(drop, "").slice(0, max) : "";
}

/** 계좌이체 주문 접수. 입금 확인은 관리자가 수동으로 한다. */
export async function POST(req: Request): Promise<Response> {
  if (!isStoreReady()) {
    return Response.json(
      { error: "지금은 주문을 받을 수 없어요. 잠시 후 다시 시도해주세요." },
      { status: 503 },
    );
  }

  let body: {
    name?: unknown;
    email?: unknown;
    bookTitle?: unknown;
    source?: unknown;
    referrer?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const name = clean(body.name, 40);
  const email = clean(body.email, 120);
  const bookTitle = clean(body.bookTitle, 120);
  // 유입 정보는 클라이언트가 보내는 값이라 서버에서 다시 깎는다(퍼널 꼬리표 규칙과 같은 모양).
  const source = tag(body.source, /[^a-z0-9-]/g, 16);
  const referrer = tag(body.referrer, /[^a-z0-9.-]/g, 40);

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
    ...(source ? { source } : {}),
    ...(referrer ? { referrer } : {}),
  };

  await saveOrder(order);

  // 통계 실패가 주문 접수를 되돌리면 안 된다
  try {
    await track(["order:submit"]);
  } catch {
    /* 조용히 실패 */
  }

  // 접수 확인(손님)·새 주문 알림(관리자). 발송 실패해도 주문은 이미 접수됐다.
  const orderNo = shortId(order.id);
  await mailOrderReceived({
    email: order.email,
    name: order.name,
    bookTitle: order.bookTitle,
    amount: order.amount,
    orderNo,
    deadline: payDeadline(order.createdAt),
  });
  await mailAdminNewOrder({
    name: order.name,
    email: order.email,
    bookTitle: order.bookTitle,
    amount: order.amount,
    orderNo,
  });

  return Response.json({
    ok: true,
    id: order.id,
    token: order.token,
    orderNo,
  });
}
