// 공유 링크용 삽화·음성을 브라우저에서 저장소로 바로 올리기 위한 서명 URL 발급.
// (서버를 거치면 Vercel 함수 요청 본문 4.5MB 제한에 걸린다)
// 2026-09-05 Vercel Blob의 handleUpload → Supabase Storage 서명 업로드로 교체.
import { consumeQuota, SHARE_UPLOAD_DAILY_LIMIT } from "@/lib/limits";
import { isStorageConfigured, signUpload } from "@/lib/storage";

const PATH_RE = /^books\/[0-9a-f]{32}\/(p\d{1,2}\.jpg|a\d{1,2})$/;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/wav",
]);

export async function POST(request: Request): Promise<Response> {
  let body: { pathname?: unknown; contentType?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  const pathname = typeof body.pathname === "string" ? body.pathname : "";
  const contentType = typeof body.contentType === "string" ? body.contentType.split(";")[0] : "";
  if (!PATH_RE.test(pathname)) {
    return Response.json({ error: "허용되지 않은 경로예요." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(contentType)) {
    return Response.json({ error: "허용되지 않은 파일 형식이에요." }, { status: 400 });
  }
  if (!isStorageConfigured()) {
    return Response.json({ error: "저장소가 설정되지 않았어요." }, { status: 500 });
  }
  if (!(await consumeQuota("share-upload", SHARE_UPLOAD_DAILY_LIMIT))) {
    return Response.json(
      { error: "오늘은 공유 링크 만들기가 많아 잠시 쉬어갈게요. 내일 다시 시도해주세요." },
      { status: 429 },
    );
  }
  try {
    const uploadUrl = await signUpload(pathname);
    return Response.json({ uploadUrl });
  } catch (err) {
    console.error("share upload sign failed:", err);
    return Response.json({ error: "업로드 준비에 실패했어요." }, { status: 500 });
  }
}
