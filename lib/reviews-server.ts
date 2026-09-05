// 후기 저장소 접근 (비공개 Supabase Storage). 라우트 파일은 정해진 export만 허용되므로 여기로 뺀다.
import { REVIEW_PREFIX, reviewPath, type Review } from "@/lib/reviews";
import {
  deleteObjects,
  getJson,
  isStorageConfigured,
  listObjects,
  putObject,
} from "@/lib/storage";

export async function loadReviews(): Promise<Review[]> {
  if (!isStorageConfigured()) return [];
  try {
    const entries = await listObjects(REVIEW_PREFIX.slice(0, -1));
    const out = await Promise.all(
      entries
        .filter((e) => e.id && e.name.endsWith(".json"))
        .map(async (e) => {
          try {
            return await getJson<Review>(`${REVIEW_PREFIX}${e.name}`);
          } catch {
            return null;
          }
        }),
    );
    return out.filter((r): r is Review => !!r && typeof r.id === "string");
  } catch (err) {
    console.error("review list failed:", err);
    return [];
  }
}

export async function saveReview(review: Review): Promise<void> {
  await putObject(reviewPath(review.id), JSON.stringify(review), "application/json");
}

export async function deleteReview(id: string): Promise<void> {
  await deleteObjects([reviewPath(id)]);
}
