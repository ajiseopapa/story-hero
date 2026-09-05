// 공유 책의 삽화·음성 전달. 저장소는 비공개라 이 라우트를 거쳐야만 볼 수 있고,
// 보관 기간(1년)이 지나면 링크를 알고 있어도 더 이상 내주지 않는다.
import { get as blobGet } from "@vercel/blob";
import { ASSET_RE, bookPrefix, ID_RE, isExpired } from "@/lib/sharebook";
import { getObject, isStorageConfigured } from "@/lib/storage";

// 보던 사람의 브라우저에만 잠깐 남기고 공용 캐시에는 두지 않는다 (지우면 바로 사라지도록)
const CACHE = "private, max-age=600";

/** 옮기기 전 책이 옛 Vercel Blob에만 있을 때의 폴백(읽기는 아직 된다) */
async function legacy(path: string): Promise<Response | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    // 정지된 스토어가 응답을 안 주면 손님 요청이 통째로 매달린다 — 5초만 기다린다
    const res = await blobGet(path, {
      access: "private",
      useCache: false,
      abortSignal: AbortSignal.timeout(5_000),
    });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    if (isExpired(res.blob.uploadedAt.getTime())) return new Response("Gone", { status: 410 });
    return new Response(res.stream, {
      headers: {
        "content-type": res.blob.contentType || "application/octet-stream",
        "content-length": String(res.blob.size),
        "cache-control": CACHE,
      },
    });
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
): Promise<Response> {
  const { id, file } = await params;
  if (!ID_RE.test(id) || !ASSET_RE.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  const path = `${bookPrefix(id)}${file}`;

  if (isStorageConfigured()) {
    try {
      const obj = await getObject(path);
      if (obj) {
        if (obj.modifiedAt && isExpired(obj.modifiedAt)) {
          return new Response("Gone", { status: 410 });
        }
        const headers: Record<string, string> = {
          "content-type": obj.contentType,
          "cache-control": CACHE,
        };
        if (obj.size) headers["content-length"] = String(obj.size);
        return new Response(obj.stream, { headers });
      }
    } catch (err) {
      console.error("book asset read failed:", err);
    }
  }
  return (await legacy(path)) ?? new Response("Not found", { status: 404 });
}
