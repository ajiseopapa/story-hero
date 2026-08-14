// 보관 기간(1년)이 지난 공유 책과, 일일 한도 계산용 마커(limits/)를 지우는 정리 작업.
// vercel.json의 크론이 하루 한 번 부른다.
import { del, list } from "@vercel/blob";
import { SHARE_TTL_DAYS } from "@/lib/sharebook";

export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
// 한도 마커는 "오늘" 것만 의미 있다 — 어제 것부터 지워도 되지만, 시간대 경계 실수를
// 피해 이틀 여유를 둔다. 안 지우면 날짜별 마커가 무한히 쌓인다(Blob엔 TTL이 없다).
const LIMITS_KEEP_DAYS = 2;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  return req.headers.get("x-vercel-cron") !== null; // 시크릿을 안 넣었으면 Vercel 크론만 허용
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ deleted: 0 });

  const cutoff = Date.now() - SHARE_TTL_DAYS * DAY_MS;
  let deleted = 0;
  let cursor: string | undefined;

  try {
    do {
      const page = await list({ prefix: "books/", cursor, limit: 500 });
      const stale = page.blobs
        .filter((b) => b.uploadedAt.getTime() < cutoff)
        .map((b) => b.url);
      if (stale.length) {
        await del(stale);
        deleted += stale.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error("share cleanup failed:", err);
    return Response.json({ error: "cleanup failed", deleted }, { status: 500 });
  }

  // 오래된 한도 마커 정리 — 경로가 limits/{YYYY-MM-DD}/... 라 업로드 시각 대신
  // 경로의 날짜로 판단한다(그날 자정 이후 마커도 그날 것으로 묶여 있어야 하므로).
  let markersDeleted = 0;
  try {
    const keepAfter = new Date(Date.now() - LIMITS_KEEP_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10);
    let markerCursor: string | undefined;
    do {
      const page = await list({ prefix: "limits/", cursor: markerCursor, limit: 1000 });
      const stale = page.blobs
        .filter((b) => (b.pathname.split("/")[1] ?? "") < keepAfter)
        .map((b) => b.url);
      if (stale.length) {
        await del(stale);
        markersDeleted += stale.length;
      }
      markerCursor = page.hasMore ? page.cursor : undefined;
    } while (markerCursor);
  } catch (err) {
    // 마커 정리 실패는 다음 날 다시 시도하면 된다 — 책 정리 결과까지 500으로 만들지 않는다
    console.error("limits marker cleanup failed:", err);
  }

  return Response.json({ deleted, markersDeleted });
}
