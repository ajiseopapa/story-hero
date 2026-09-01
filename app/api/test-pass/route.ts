import { NextResponse } from "next/server";
import { TEST_COOKIE, testToken } from "@/lib/test-pass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 테스트 통행증을 이 브라우저에 심는다.
 *
 *   /api/test-pass?t=<토큰>   통행증 켜기 → 홈으로 이동
 *   /api/test-pass?off=1      끄기
 *
 * 토큰은 주소에 한 번만 나타나고, 바로 홈으로 옮겨가므로 화면·기록에 남지 않는다.
 * 켠 브라우저의 방문·클릭은 퍼널 집계에서도 빠진다(홈의 ?test=1 → lib/track.ts).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.searchParams.get("off")) {
    const res = NextResponse.redirect(new URL("/?test=0", req.url));
    res.cookies.set(TEST_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }

  const token = testToken();
  const given = url.searchParams.get("t") ?? "";
  if (!token || given !== token) {
    // 링크가 틀렸다고 알려주지 않는다 — 존재 자체를 노출하지 않는 편이 낫다
    return NextResponse.redirect(new URL("/", req.url));
  }

  const res = NextResponse.redirect(new URL("/?test=1", req.url));
  res.cookies.set(TEST_COOKIE, token, {
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
