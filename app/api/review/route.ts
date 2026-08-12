// 후기 제출(POST)과 공개 목록 조회(GET). 승인 전에는 어디에도 노출되지 않는다.
import { randomBytes } from "node:crypto";
import { consumeQuota, ipBucket } from "@/lib/limits";
import { parseSubmission, PUBLIC_LIMIT, toPublic, type Review } from "@/lib/reviews";
import { loadReviews, saveReview } from "@/lib/reviews-server";

const REVIEW_IP_DAILY_LIMIT = Number(process.env.REVIEW_IP_DAILY_LIMIT ?? "3");

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const parsed = parseSubmission(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  if (!(await consumeQuota(`review/${ipBucket(req)}`, REVIEW_IP_DAILY_LIMIT))) {
    return Response.json(
      { error: "오늘은 후기를 더 남길 수 없어요. 내일 다시 시도해주세요." },
      { status: 429 },
    );
  }

  const review: Review = {
    id: randomBytes(12).toString("hex"),
    rating: parsed.rating,
    text: parsed.text,
    nickname: parsed.nickname,
    bookTitle: parsed.bookTitle,
    createdAt: Date.now(),
    approved: false, // 승인 전까지 비공개
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
