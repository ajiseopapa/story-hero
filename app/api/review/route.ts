// 후기 제출(POST)과 공개 목록 조회(GET). 승인 전에는 어디에도 노출되지 않는다.
import { randomBytes } from "node:crypto";
import { consumeQuota, ipBucket } from "@/lib/limits";
import { ID_RE as ORDER_ID_RE, getOrder, tokenMatches, type Order } from "@/lib/orders";
import { parseSubmission, PUBLIC_LIMIT, toPublic, type Review } from "@/lib/reviews";
import { loadReviews, saveReview } from "@/lib/reviews-server";

const REVIEW_IP_DAILY_LIMIT = Number(process.env.REVIEW_IP_DAILY_LIMIT ?? "3");

/** 주문번호+토큰이 맞고 입금까지 확인된 주문이면 그 주문을, 아니면 null. */
async function verifyOrder(body: unknown): Promise<Order | null> {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = typeof b.o === "string" ? b.o : "";
  const token = typeof b.t === "string" ? b.t : "";
  if (!ORDER_ID_RE.test(id) || !token) return null;
  const order = await getOrder(id);
  if (!order || !tokenMatches(order.token, token) || order.status !== "paid") return null;
  return order;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const parsed = parseSubmission(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  // 후기 전용 주소(/review?o=..&t=..)로 온 후기는 주문을 확인한다. 확인되면 책 제목을
  // 손님이 보낸 값이 아니라 주문 기록에서 가져오고, 한도도 IP가 아니라 주문 단위로 센다
  // — 메일 링크를 누른 손님이 남의 IP 한도에 걸려 못 쓰면 안 된다.
  const verified = await verifyOrder(body);

  const bucket = verified ? `review/order/${verified.id}` : `review/${ipBucket(req)}`;
  const limit = verified ? 1 : REVIEW_IP_DAILY_LIMIT;
  if (!(await consumeQuota(bucket, limit))) {
    return Response.json(
      {
        error: verified
          ? "이 주문의 후기는 이미 받았어요. 고맙습니다!"
          : "오늘은 후기를 더 남길 수 없어요. 내일 다시 시도해주세요.",
      },
      { status: 429 },
    );
  }

  const review: Review = {
    id: randomBytes(12).toString("hex"),
    rating: parsed.rating,
    text: parsed.text,
    nickname: parsed.nickname,
    bookTitle: verified ? verified.bookTitle : parsed.bookTitle,
    createdAt: Date.now(),
    approved: false, // 승인 전까지 비공개
    ...(verified ? { orderId: verified.id } : {}),
  };

  try {
    await saveReview(review);
  } catch (err) {
    console.error("review save failed:", err);
    return Response.json({ error: "후기를 저장하지 못했어요." }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function GET(): Promise<Response> {
  const reviews = await loadReviews();
  const approved = reviews
    .filter((r) => r.approved)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, PUBLIC_LIMIT)
    .map(toPublic);

  return Response.json(
    { reviews: approved },
    { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
  );
}
