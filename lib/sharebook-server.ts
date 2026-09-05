// 공유 링크 서버 쪽 헬퍼 — 비공개 저장소에서 책 명세를 읽고, 책 한 권을 통째로 지운다.
import { bookPrefix, manifestPath, type ShareManifest } from "@/lib/sharebook";
import { deleteObjects, getJson, isStorageConfigured, listObjects } from "@/lib/storage";

function valid(m: ShareManifest | null): m is ShareManifest {
  return !!m && m.v === 1 && Array.isArray(m.pages);
}

export async function readManifest(id: string): Promise<ShareManifest | null> {
  if (!isStorageConfigured()) return null;
  try {
    const m = await getJson<ShareManifest>(manifestPath(id));
    return valid(m) ? m : null;
  } catch (err) {
    console.error("manifest read failed:", err);
    return null; // 없는 링크·잘못된 내용은 모두 "없음"으로 다룬다
  }
}

// prefix 아래(삽화·음성·명세) 전부 삭제
export async function deleteBook(id: string): Promise<void> {
  if (!isStorageConfigured()) return;
  const prefix = bookPrefix(id); // books/{id}/
  const entries = await listObjects(prefix.slice(0, -1));
  const files = entries.filter((e) => e.id).map((e) => `${prefix}${e.name}`);
  await deleteObjects(files);
}
