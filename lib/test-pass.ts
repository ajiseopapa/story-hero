/**
 * 테스트 통행증.
 *
 * 인앱 브라우저에서 흐름을 확인하려면 하루 3회(기기당) 한도에 금방 걸린다(2026-09-01).
 * 이 쿠키를 가진 브라우저만 기기·IP 한도를 건너뛴다. 전체 일일 한도는 그대로 적용된다 —
 * 통행증이 새더라도 하루 비용 상한은 지켜져야 한다.
 *
 * 토큰은 관리자 키에서 파생한다. 새 환경변수를 만들지 않아도 되고, 이 값이 새어도
 * 관리자 키를 되돌려 알아낼 수 없다. 링크는 /admin/funnel 화면에서 확인한다.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const TEST_COOKIE = "kb_test";

/** 관리자 키가 없으면 통행증 자체가 존재하지 않는다(= 아무도 못 건너뛴다). */
export function testToken(): string | null {
  const key = process.env.ADMIN_KEY || process.env.REVIEW_ADMIN_KEY;
  if (!key) return null;
  return createHash("sha256").update(`${key}:kidsbook-test-pass`).digest("hex").slice(0, 24);
}

export function hasTestPass(req: Request): boolean {
  const token = testToken();
  if (!token) return false;
  const m = req.headers.get("cookie")?.match(/(?:^|;\s*)kb_test=([a-f0-9]{24})(?:;|\s|$)/);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
