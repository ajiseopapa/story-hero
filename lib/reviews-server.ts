// 후기 저장소 접근 (비공개 Blob). 라우트 파일은 정해진 export만 허용되므로 여기로 뺀다.
import { del, get, list, put } from "@vercel/blob";
import { REVIEW_PREFIX, reviewPath, type Review } from "@/lib/reviews";

export async function loadReviews(): Promise<Review[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  try {
    const { blobs } = await list({ prefix: REVIEW_PREFIX, limit: 200 });
    const out = await Promise.all(
      blobs.map(async (b) => {
        try {
          const res = await get(b.pathname, { access: "private", useCache: false });
          if (!res || res.statusCode !== 200 || !res.stream) return null;
          return (await new Response(res.stream).json()) as Review;
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
  await put(reviewPath(review.id), JSON.stringify(review), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function deleteReview(id: string): Promise<void> {
  const { blobs } = await list({ prefix: reviewPath(id), limit: 1 });
  if (blobs.length) await del(blobs.map((b) => b.url));
}
