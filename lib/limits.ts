// 일일 생성 한도 (무료 샘플 비용 폭탄 방지 — 앱인토스 등 트래픽 유입 대비).
// Vercel Blob에 요청당 마커 블롭 하나를 남기고, prefix 목록 개수로 사용량을 센다.
// 읽고-더하고-쓰는 카운터가 아니라 마커 방식이라 동시 요청 간 레이스가 없다.
import { list, put } from "@vercel/blob";
import { createHash } from "node:crypto";

// 날짜 경계는 한국 시간 기준
function todayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// bucket의 오늘 사용량이 limit 미만이면 1 소진하고 true, 초과면 false.
// Blob 토큰이 없거나 오류가 나면 서비스를 막지 않도록 통과시킨다(fail-open).
export async function consumeQuota(bucket: string, limit: number): Promise<boolean> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return true;
  try {
    const prefix = `limits/${todayKST()}/${bucket}/`;
    const { blobs, hasMore } = await list({
      prefix,
      limit: Math.min(limit, 1000),
    });
    if (hasMore || blobs.length >= limit) return false;
    await put(`${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, "1", {
      access: "private",
      addRandomSuffix: true,
    });
    return true;
  } catch (err) {
    console.warn("quota check failed (fail-open):", err);
    return true;
  }
}

// 요청 IP를 짧은 해시로 (프라이버시 보호 + 버킷 키로 사용)
export function ipBucket(req: Request): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT ?? "100"); // 전체 무료 샘플/일
export const FREE_IP_DAILY_LIMIT = Number(process.env.FREE_IP_DAILY_LIMIT ?? "3"); // IP당 무료 샘플/일
export const IMAGE_DAILY_LIMIT = Number(process.env.IMAGE_DAILY_LIMIT ?? "1500"); // 삽화 생성/일 (유료 이어그리기 포함 백스톱)
export const SHARE_DAILY_LIMIT = Number(process.env.SHARE_DAILY_LIMIT ?? "50"); // 공유 링크 생성/일 (전체)
export const SHARE_IP_DAILY_LIMIT = Number(process.env.SHARE_IP_DAILY_LIMIT ?? "5"); // 공유 링크 생성/일 (IP당)
export const SHARE_UPLOAD_DAILY_LIMIT = Number(process.env.SHARE_UPLOAD_DAILY_LIMIT ?? "1500"); // 공유용 파일 업로드/일 (한 권에 최대 22개)
