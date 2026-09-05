// 공유 링크 서버 쪽 헬퍼 — 비공개 저장소에서 책 명세를 읽고, 책 한 권을 통째로 지운다.
import { get as blobGet } from "@vercel/blob";
import { bookPrefix, manifestPath, type ShareManifest } from "@/lib/sharebook";
import { deleteObjects, getJson, isStorageConfigured, listObjects } from "@/lib/storage";

function valid(m: ShareManifest | null): m is ShareManifest {
  return !!m && m.v === 1 && Array.isArray(m.pages);
}

/**
 * 옮기기 전(2026-09-05 이전)에 만든 책이 옛 Vercel Blob에만 남아 있을 때의 폴백.
 * 옛 스토어는 쓰기만 막히고 읽기는 되므로, 복사 스크립트가 빠뜨린 책도 열린다.
 */
export async function readManifestLegacy(id: string): Promise<ShareManifest | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const res = await blobGet(manifestPath(id), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const m = (await new Response(res.stream).json()) as ShareManifest;
    return valid(m) ? m : null;
  } catch {
    return null;
  }
}

export async function readManifest(id: string): Promise<ShareManifest | null> {
  if (isStorageConfigured()) {
    try {
      const m = await getJson<ShareManifest>(manifestPath(id));
      if (valid(m)) return m;
    } catch (err) {
      console.error("manifest read failed:", err);
    }
  }
  return readManifestLegacy(id);
}

// prefix 아래(삽화·음성·명세) 전부 삭제
export async function deleteBook(id: string): Promise<void> {
  if (!isStorageConfigured()) return;
  const prefix = bookPrefix(id); // books/{id}/
  const entries = await listObjects(prefix.slice(0, -1));
  const files = entries.filter((e) => e.id).map((e) => `${prefix}${e.name}`);
  await deleteObjects(files);
}
