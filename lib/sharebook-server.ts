// 공유 링크 서버 쪽 헬퍼 — 비공개 Blob에서 책 명세를 읽고, 책 한 권을 통째로 지운다.
import { del, get, list } from "@vercel/blob";
import { bookPrefix, manifestPath, type ShareManifest } from "@/lib/sharebook";

export async function readManifest(id: string): Promise<ShareManifest | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    // useCache: false — 지운 링크가 CDN 캐시 때문에 계속 열리면 안 된다
    const res = await get(manifestPath(id), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const manifest = (await new Response(res.stream).json()) as ShareManifest;
    if (manifest?.v !== 1 || !Array.isArray(manifest.pages)) return null;
    return manifest;
  } catch {
    return null; // 없는 링크·잘못된 내용은 모두 "없음"으로 다룬다
  }
}

// prefix 아래(삽화·음성·명세) 전부 삭제
export async function deleteBook(id: string): Promise<void> {
  const prefix = bookPrefix(id);
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 100 });
    if (page.blobs.length) await del(page.blobs.map((b) => b.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
