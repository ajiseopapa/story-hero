import { NextResponse } from "next/server";
import { TEST_COOKIE, TEST_UI_COOKIE, hasTestPass, testToken } from "@/lib/test-pass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE = 60 * 60 * 24 * 30;

/**
 * 테스트 통행증을 이 브라우저에 심는다.
 *
 *   /api/test-pass?t=<토큰>   통행증 켜기 → 홈으로 이동
 *   /api/test-pass?off=1      끄기
 *
 * 토큰은 주소에 한 번만 나타나고, 바로 홈으로 옮겨가므로 화면·기록에 남지 않는다.
 *
 * 쿠키는 두 개다. kb_test(httpOnly)는 서버가 한도를 건너뛸 때 확인하는 진짜 통행증이고,
 * kb_test_ui는 화면이 "이 브라우저는 테스트 중"임을 알 수 있게 하는 표식이다.
 * 예전엔 홈 주소에 ?test=1을 붙여 표식을 남겼는데, 그 주소가 그대로 공유되면 받은 손님
 * 브라우저에도 표식이 남아 경고 배지가 뜨고 집계에서 빠졌다(2026-09-05). 표식을 쿠키로
 * 옮기면 이 서버가 직접 심은 브라우저 밖으로는 절대 퍼지지 않는다.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // 이 브라우저에 통행증이 실제로 붙어 있는지. 링크를 다른 브라우저에서 열면 조용히
  // 실패하는데(쿠키는 브라우저마다 따로다), 그걸 화면에서 알 수 있어야 한다.
  if (url.searchParams.get("check")) {
    return Response.json({ active: hasTestPass(req) }, { headers: { "cache-control": "no-store" } });
  }

  if (url.searchParams.get("off")) {
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(TEST_COOKIE, "", { maxAge: 0, path: "/" });
    res.cookies.set(TEST_UI_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }

  const token = testToken();
  const given = url.searchParams.get("t") ?? "";
  if (!token || given !== token) {
    // 링크가 틀렸다고 알려주지 않는다 — 존재 자체를 노출하지 않는 편이 낫다
    return NextResponse.redirect(new URL("/", req.url));
  }

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(TEST_COOKIE, token, {
    maxAge: MAX_AGE,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  // 화면용 표식 — 값은 아무 의미 없는 "1"이라 새어도 통행증이 되지 않는다.
  res.cookies.set(TEST_UI_COOKIE, "1", {
    maxAge: MAX_AGE,
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
