// 보관 기간(1년)이 지난 공유 책을 실제로 지우는 정리 작업. vercel.json의 크론이 하루 한 번 부른다.
import { del, list } from "@vercel/blob";
import { SHARE_TTL_DAYS } from "@/lib/sharebook";

export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

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

  return Response.json({ deleted });
}
