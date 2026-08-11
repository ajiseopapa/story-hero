// 공유 링크용 삽화·음성을 브라우저에서 Blob으로 바로 올리기 위한 토큰 발급.
// (서버를 거치면 Vercel 함수 요청 본문 4.5MB 제한에 걸린다)
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { consumeQuota, SHARE_UPLOAD_DAILY_LIMIT } from "@/lib/limits";

const PATH_RE = /^books\/[0-9a-f]{32}\/(p\d{1,2}\.jpg|a\d{1,2})$/;
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!PATH_RE.test(pathname)) throw new Error("허용되지 않은 경로예요.");
        if (!(await consumeQuota("share-upload", SHARE_UPLOAD_DAILY_LIMIT))) {
          throw new Error("오늘은 공유 링크 만들기가 많아 잠시 쉬어갈게요. 내일 다시 시도해주세요.");
        }
        return {
          allowedContentTypes: [
            "image/jpeg",
            "audio/mpeg",
            "audio/mp4",
            "audio/webm",
            "audio/ogg",
            "audio/wav",
          ],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 300, // 지운 파일이 Blob CDN에 오래 남지 않도록 짧게

        };
      },
      onUploadCompleted: async () => {
        // 업로드 완료 콜백은 쓰지 않는다 (명세는 /api/share에서 따로 저장)
      },
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "업로드에 실패했어요.";
    return Response.json({ error: message }, { status: 400 });
  }
}
