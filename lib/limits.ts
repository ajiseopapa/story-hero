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
// 토큰이 없으면(로컬 개발) 통과시키되, 검사 자체가 오류를 내면 막는다(fail-closed) —
// Blob 장애 순간에 한도가 통째로 풀리면 그 시간 동안 OpenAI 비용 상한이 사라진다.
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
    console.error("quota check failed (fail-closed):", err);
    return false;
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

// 무료 샘플의 1차 신원은 쿠키 기반 익명 기기 ID다. IP는 통신사 NAT(CGNAT)에서 수천 명이
// 공유하므로 "기기당"의 신원이 될 수 없다 — IP당 3회로 막으면 처음 온 손님이 남이 쓴 한도에
// 걸려 이탈한다 (2026-08-13). 쿠키를 지우면 새 ID가 되지만, 그 우회는 느슨한 IP 백스톱과
// 전체 한도가 막는다.
export const DEVICE_COOKIE = "kb_device";

export function readDeviceId(req: Request): { id: string; isNew: boolean } {
  const m = req.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)kb_device=([A-Za-z0-9-]{8,64})(?:;|\s|$)/);
  if (m) return { id: m[1], isNew: false };
  return { id: crypto.randomUUID(), isNew: true };
}

export const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT ?? "100"); // 전체 무료 샘플/일
export const FREE_DEVICE_DAILY_LIMIT = Number(process.env.FREE_DEVICE_DAILY_LIMIT ?? "3"); // 기기(쿠키)당 무료 샘플/일
export const FREE_IP_DAILY_LIMIT = Number(process.env.FREE_IP_DAILY_LIMIT ?? "20"); // IP당 백스톱 (쿠키 삭제 우회 방지)
// 아직 쓰지 않은 유효한 쿠폰을 들고 온 손님은 기기·IP 한도를 건너뛴다 — 대신 쿠폰 코드당으로
// 센다(2026-09-05). 쿠폰 손님은 마음에 드는 샘플이 나올 때까지 몇 번 더 만들어 보고 열어야
// 하는데, 기기당 3회에 걸려 쿠폰을 넣는 화면까지 못 갔다. 코드당 하루 5권 샘플(삽화 10장 +
// 재시도 여유)이면 넉넉하고, 코드 하나가 새도 하루 손실은 정해져 있다.
export const COUPON_STORY_DAILY_LIMIT = Number(process.env.COUPON_STORY_DAILY_LIMIT ?? "5");
export const COUPON_IMAGE_DAILY_LIMIT = Number(process.env.COUPON_IMAGE_DAILY_LIMIT ?? "15");
// 삽화 생성/일 (유료 이어그리기 포함 백스톱).
// 1장당 약 156원(2026-08-13 실측)이라 한도가 곧 사고 시 최대 손실액이다.
// 1500이면 하루 23만원이 걸리는데, 정상 사용으로 그 수치가 나오려면 하루 136권(매출 200만원)이
// 팔려야 한다 — 실제 트래픽과 너무 동떨어져 방어가 되지 않았다. 300이면 하루 27권까지 여유가
// 있으면서 노출은 4.7만원으로 줄어든다. 실제로 팔리기 시작하면 env로 올리면 된다.
//
// 2026-08-26: 결국 OpenAI 쪽 상한이 더 낮았다 — 자동충전 월 한도가 $100(약 14만원)이라
// 이 기본값 300(하루 4.7만원)은 사흘이면 그 돈을 태운다. 운영 env를 120으로 내려
// 두 상한을 맞췄다(무료 샘플 40장 + 유료 8권 72장 여유 = 하루 최대 1.9만원).
// 팔리기 시작하면 OpenAI 월 한도와 이 값을 같이 올려야 한다 — 한쪽만 올리면 의미가 없다.
export const IMAGE_DAILY_LIMIT = Number(process.env.IMAGE_DAILY_LIMIT ?? "300");
// 삽화 생성 IP당/일 — 결제 안 한 요청에만 적용. 무료 샘플은 한 번에 2장(표지+1장면)이고
// 이야기 자체가 IP당 3회/일이라, 재시도까지 감안해도 12면 정상 사용을 막지 않는다.
// (스크립트 남용 시 노출: 12장 × 156원 ≈ 1,900원/IP/일)
export const IMAGE_FREE_IP_DAILY_LIMIT = Number(process.env.IMAGE_FREE_IP_DAILY_LIMIT ?? "12");
// 결제한 주문 하나가 평생 그릴 수 있는 삽화 수 — 한 권 11장 + 오류 재시도 여유.
// 주문 토큰이 유출돼도 이 수를 넘으면 더 못 그린다.
export const ORDER_IMAGE_LIMIT = Number(process.env.ORDER_IMAGE_LIMIT ?? "60");
export const SHARE_DAILY_LIMIT = Number(process.env.SHARE_DAILY_LIMIT ?? "50"); // 공유 링크 생성/일 (전체)
export const SHARE_IP_DAILY_LIMIT = Number(process.env.SHARE_IP_DAILY_LIMIT ?? "5"); // 공유 링크 생성/일 (IP당)
export const SHARE_UPLOAD_DAILY_LIMIT = Number(process.env.SHARE_UPLOAD_DAILY_LIMIT ?? "1500"); // 공유용 파일 업로드/일 (한 권에 최대 22개)

// 읽어주기(TTS)/일. 여기만 한도가 없어서 누구나 무제한으로 부를 수 있었다(2026-08-13).
// 1회 상한 1,000자면 약 85원이라 스크립트로 돌리면 시간당 수만원이 나간다.
// 한 권 전체 낭독이 11회이고 화자를 바꿔 다시 들을 수 있어 IP당 60회면 정상 사용엔 넉넉하다.
export const TTS_DAILY_LIMIT = Number(process.env.TTS_DAILY_LIMIT ?? "400"); // 전체
export const TTS_IP_DAILY_LIMIT = Number(process.env.TTS_IP_DAILY_LIMIT ?? "60"); // IP당
