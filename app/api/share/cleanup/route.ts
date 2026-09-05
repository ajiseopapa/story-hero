// 보관 기간(1년)이 지난 공유 책을 지우는 정리 작업. vercel.json의 크론이 하루 한 번 부른다.
// (일일 한도 마커는 2026-09-05부터 KV에 TTL로 두므로 여기서 지울 게 없다.)
import { SHARE_TTL_DAYS } from "@/lib/sharebook";
import { deleteObjects, isStorageConfigured, listObjects } from "@/lib/storage";

export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  return req.headers.get("x-vercel-cron") !== null; // 시크릿을 안 넣었으면 Vercel 크론만 허용
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  if (!isStorageConfigured()) return Response.json({ deleted: 0 });

  const cutoff = Date.now() - SHARE_TTL_DAYS * DAY_MS;
  let deleted = 0;

  try {
    // books/ 아래는 책 id 폴더들 — 폴더는 시각이 없어서 안을 들여다봐야 한다
    const folders = (await listObjects("books")).filter((e) => !e.id);
    for (const folder of folders) {
      const files = (await listObjects(`books/${folder.name}`)).filter((e) => e.id);
      const stale = files
        .filter((e) => (e.createdAt ?? e.updatedAt ?? Date.now()) < cutoff)
        .map((e) => `books/${folder.name}/${e.name}`);
      if (stale.length) {
        await deleteObjects(stale);
        deleted += stale.length;
      }
    }
  } catch (err) {
    console.error("share cleanup failed:", err);
    return Response.json({ error: "cleanup failed", deleted }, { status: 500 });
  }

  return Response.json({ deleted });
}
