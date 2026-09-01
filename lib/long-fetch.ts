"use client";

/**
 * 오래 걸리는 생성 요청과, 그동안 화면을 살아 있게 만드는 진행률.
 *
 * 무료 샘플 한 편은 이야기 76초 + 삽화 두 장이라 3분 가까이 걸린다(2026-09-01 운영 실측).
 * 그 시간을 견디게 하는 두 가지가 여기 있다 — 끊긴 요청을 다시 잇는 것과, 막대가 멈춘 것처럼
 * 보이지 않게 하는 것.
 */

/**
 * 진행률을 시간에 따라 목표치로 밀어올린다.
 *
 * 이야기 한 편을 쓰는 데 76초가 걸리는데(2026-09-01 운영 실측) 그동안 막대가 4%에 붙어 있어서
 * 멈춘 것으로 보였다. 서버가 중간 진행을 알려주지 않는 구간이라, 남은 거리를 조금씩 좁히며
 * 목표에 닿지는 않게 한다 — 다 찼는데 안 끝나는 것보다 계속 미세하게 움직이는 편이 낫다.
 */
export function ramp(
  setPct: (n: number) => void,
  from: number,
  to: number,
  seconds: number,
): () => void {
  const TICK = 400;
  // seconds 즈음에 남은 거리의 95%를 좁히는 감쇠율
  const rate = 1 - Math.pow(0.05, TICK / (seconds * 1000));
  let cur = from;
  setPct(Math.round(cur));
  const id = setInterval(() => {
    cur += (to - cur) * rate;
    setPct(Math.round(Math.min(cur, to - 1)));
  }, TICK);
  return () => clearInterval(id);
}

/**
 * 오래 걸리는 생성 요청.
 *
 * 이야기 76초 + 삽화 두 장이라 한 요청이 몇 분씩 걸리는데, 모바일 네트워크와 인앱 브라우저는
 * 그렇게 긴 요청을 그냥 끊는다(2026-09-01 실제로 "커넥션 에러"로 이탈). 끊긴 경우에만 한 번
 * 더 시도한다 — 4xx·429는 다시 해도 결과가 같으므로 그대로 돌려준다.
 */
export async function postLong(url: string, body: unknown, timeoutMs: number): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      // 게이트웨이가 끊어버린 응답만 재시도 가치가 있다
      if (attempt === 0 && res.status >= 502 && res.status <= 504) continue;
      return res;
    } catch {
      if (attempt === 1) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("연결이 끊겼어요. 신호가 안정된 곳에서 다시 시도해주세요.");
}
