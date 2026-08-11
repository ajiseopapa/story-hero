// 공유 책의 삽화·음성 전달. 블롭은 비공개라 이 라우트를 거쳐야만 볼 수 있고,
// 보관 기간(1년)이 지나면 링크를 알고 있어도 더 이상 내주지 않는다.
import { get } from "@vercel/blob";
import { ASSET_RE, bookPrefix, ID_RE, isExpired } from "@/lib/sharebook";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
): Promise<Response> {
  const { id, file } = await params;
  if (!ID_RE.test(id) || !ASSET_RE.test(file)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    // useCache: false — 링크를 지우면 바로 안 보여야 한다 (CDN 캐시 우회)
    const res = await get(`${bookPrefix(id)}${file}`, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) {
      return new Response("Not found", { status: 404 });
    }
    if (isExpired(res.blob.uploadedAt.getTime())) {
      return new Response("Gone", { status: 410 });
    }
    return new Response(res.stream, {
      headers: {
        "content-type": res.blob.contentType || "application/octet-stream",
        "content-length": String(res.blob.size),
        // 보던 사람의 브라우저에만 잠깐 남기고 공용 캐시에는 두지 않는다 (지우면 바로 사라지도록)
        "cache-control": "private, max-age=600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
