// 공유 링크 만들기 — 브라우저에서만 도는 부분.
// 삽화 data URL(PNG)을 폰에서 빨리 열리도록 JPEG로 줄여서 Blob에 직접 올린다.
// (Vercel 함수 요청 본문 제한 4.5MB를 피하려고 서버 경유 없이 클라이언트 업로드를 쓴다.)
import { upload } from "@vercel/blob/client";
import { audioPath, imagePath, type SharePage } from "@/lib/sharebook";

const SHARE_IMAGE_WIDTH = 1024; // 삽화 원본이 1024x1536이라 사실상 원본 유지, 포맷만 JPEG로
const SHARE_IMAGE_QUALITY = 0.86;

export function newShareId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

// data URL(PNG) → 축소 JPEG Blob
export async function dataUrlToJpeg(dataUrl: string): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("삽화를 불러오지 못했어요."));
    el.src = dataUrl;
  });
  const scale = Math.min(1, SHARE_IMAGE_WIDTH / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 변환하지 못했어요.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", SHARE_IMAGE_QUALITY),
  );
  if (!blob) throw new Error("이미지를 변환하지 못했어요.");
  return blob;
}

type UploadInput = {
  id: string;
  title: string;
  pages: { kind: "cover" | "scene"; text: string; image: string | null; audio: Blob | null }[];
  onProgress?: (done: number, total: number) => void;
};

export type ShareResult = { url: string; deleteKey: string; expiresAt: number };

// 삽화·음성을 하나씩 올린 뒤 명세를 만들어 공유 링크를 돌려준다.
export async function createShareLink({
  id,
  title,
  pages,
  onProgress,
}: UploadInput): Promise<ShareResult> {
  const total = pages.reduce((n, p) => n + (p.image ? 1 : 0) + (p.audio ? 1 : 0), 0);
  let done = 0;
  const bump = () => onProgress?.(++done, total);

  const manifestPages: SharePage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.image) {
      const jpeg = await dataUrlToJpeg(p.image);
      await upload(imagePath(id, i), jpeg, {
        access: "private",
        contentType: "image/jpeg",
        handleUploadUrl: "/api/share/upload",
      });
      bump();
    }
    if (p.audio) {
      await upload(audioPath(id, i), p.audio, {
        access: "private",
        contentType: p.audio.type || "audio/mpeg",
        handleUploadUrl: "/api/share/upload",
      });
      bump();
    }
    manifestPages.push({
      kind: p.kind,
      text: p.text,
      hasImage: !!p.image,
      hasAudio: !!p.audio,
    });
  }

  const deleteKey = newShareId();
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, title, deleteKey, pages: manifestPages }),
  });
  const data = (await res.json()) as { path?: string; expiresAt?: number; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error || "공유 링크를 만들지 못했어요.");

  return {
    url: `${location.origin}${data.path}`,
    deleteKey,
    expiresAt: data.expiresAt ?? 0,
  };
}

export async function deleteShareLink(id: string, deleteKey: string): Promise<void> {
  const res = await fetch("/api/share/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, deleteKey }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "링크를 지우지 못했어요.");
  }
}
