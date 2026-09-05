// 공유 책의 삽화·음성 전달. 저장소는 비공개라 이 라우트를 거쳐야만 볼 수 있고,
// 보관 기간(1년)이 지나면 링크를 알고 있어도 더 이상 내주지 않는다.
import { ASSET_RE, bookPrefix, ID_RE, isExpired } from "@/lib/sharebook";
import { getObject, isStorageConfigured } from "@/lib/storage";

// 보던 사람의 브라우저에만 잠깐 남기고 공용 캐시에는 두지 않는다 (지우면 바로 사라지도록)
const CACHE = "private, max-age=600";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
): Promise<Response> {
  const { id, file } = await params;
  if (!ID_RE.test(id) || !ASSET_RE.test(file) || !isStorageConfigured()) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const obj = await getObject(`${bookPrefix(id)}${file}`);
    if (!obj) return new Response("Not found", { status: 404 });
    if (obj.modifiedAt && isExpired(obj.modifiedAt)) return new Response("Gone", { status: 410 });
    const headers: Record<string, string> = {
      "content-type": obj.contentType,
      "cache-control": CACHE,
    };
    if (obj.size) headers["content-length"] = String(obj.size);
    return new Response(obj.stream, { headers });
  } catch (err) {
    console.error("book asset read failed:", err);
    return new Response("Not found", { status: 404 });
  }
}
