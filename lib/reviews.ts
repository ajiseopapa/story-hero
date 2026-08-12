// 후기 — 결제하고 책을 다 받은 사람만 남길 수 있고, 승인 전에는 공개되지 않는다.
export const REVIEW_PREFIX = "reviews/";
export const MAX_TEXT = 300;
export const MAX_NICKNAME = 20;
export const PUBLIC_LIMIT = 30;

export type Review = {
  id: string;
  rating: number; // 1~5
  text: string;
  nickname: string; // 표시용 별명 (아이 실명은 받지 않는다)
  bookTitle: string; // 어떤 동화를 만들었는지
  createdAt: number;
  approved: boolean;
};

/** 공개용으로 내보낼 때 쓰는 형태 (승인 여부·내부 정보 제외) */
export type PublicReview = Pick<
  Review,
  "id" | "rating" | "text" | "nickname" | "bookTitle" | "createdAt"
>;

export function toPublic(r: Review): PublicReview {
  return {
    id: r.id,
    rating: r.rating,
    text: r.text,
    nickname: r.nickname,
    bookTitle: r.bookTitle,
    createdAt: r.createdAt,
  };
}

export const ID_RE = /^[0-9a-f]{24}$/;

export function reviewPath(id: string): string {
  return `${REVIEW_PREFIX}${id}.json`;
}

/** 제출값 검증 — 통과하면 정제된 값을, 아니면 오류 메시지를 돌려준다. */
export function parseSubmission(body: unknown):
  | { ok: true; rating: number; text: string; nickname: string; bookTitle: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "잘못된 요청이에요." };
  const b = body as Record<string, unknown>;

  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "별점을 선택해주세요." };
  }

  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (text.length < 5) return { ok: false, error: "후기를 다섯 글자 이상 적어주세요." };
  if (text.length > MAX_TEXT) return { ok: false, error: "후기가 너무 길어요." };

  const nickname = (typeof b.nickname === "string" ? b.nickname.trim() : "").slice(
    0,
    MAX_NICKNAME,
  );
  const bookTitle = (typeof b.bookTitle === "string" ? b.bookTitle.trim() : "").slice(0, 120);

  return { ok: true, rating, text, nickname: nickname || "익명", bookTitle };
}

/** "2026년 8월 12일" */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
