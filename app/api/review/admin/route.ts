// 후기 검수 — 관리자 키를 아는 사람만 목록을 보고 공개/삭제할 수 있다.
import { ID_RE, type Review } from "@/lib/reviews";
import { deleteReview, loadReviews, saveReview } from "@/lib/reviews-server";

// 쿼리스트링(?key=)은 받지 않는다 — 액세스 로그·브라우저 히스토리·Referer에 남아 유출된다.
function authorized(req: Request): boolean {
  const key = process.env.REVIEW_ADMIN_KEY;
  if (!key) return false; // 키를 설정하기 전에는 잠가둔다
  return req.headers.get("x-admin-key") === key;
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const reviews = (await loadReviews()).sort((a, b) => b.createdAt - a.createdAt);
  return Response.json({ reviews }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  let body: { id?: unknown; action?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; action?: unknown };
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const { id, action } = body;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return Response.json({ error: "잘못된 후기 번호예요." }, { status: 400 });
  }

  if (action === "delete") {
    await deleteReview(id);
    return Response.json({ ok: true });
  }

  if (action !== "approve" && action !== "hide") {
    return Response.json({ error: "알 수 없는 동작이에요." }, { status: 400 });
  }

  const review = (await loadReviews()).find((r) => r.id === id);
  if (!review) return Response.json({ error: "후기를 찾을 수 없어요." }, { status: 404 });

  const next: Review = { ...review, approved: action === "approve" };
  await saveReview(next);
  return Response.json({ ok: true, review: next });
}
