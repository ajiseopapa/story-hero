"use client";

/**
 * 퍼널 이벤트 전송 (클라이언트).
 *
 * 원칙 두 가지:
 *  1) 퍼널 단계는 **브라우저 세션당 한 번만** 센다. 한 사람이 동화를 두 번 만들어도
 *     "샘플 완성"은 1로 세야 "온 사람 중 몇 %가 여기까지 왔나"를 읽을 수 있다.
 *     세션 구분은 sessionStorage — 탭을 닫으면 새 세션이다.
 *  2) 통계 실패는 절대 사용자 흐름을 막지 않는다. 모든 오류를 삼킨다.
 *
 * 개인정보는 보내지 않는다. 이벤트 이름 문자열뿐이다.
 */

const SEEN_KEY = "kidsbook:tracked";
const FLUSH_MS = 400;

let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function seen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function remember(names: string[]): void {
  try {
    const set = seen();
    names.forEach((n) => set.add(n));
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...set]));
  } catch {
    // 시크릿 모드 등에서 sessionStorage가 막히면 중복 집계를 감수하고 계속 보낸다
  }
}

function flush(): void {
  timer = null;
  const events = queue;
  queue = [];
  if (events.length === 0) return;
  try {
    void fetch("/api/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true, // 페이지를 떠나는 중에도 전송되게
    }).catch(() => {});
  } catch {
    // 통계는 조용히 실패한다
  }
}

/**
 * 퍼널 단계 기록 — 세션당 한 번만 전송된다.
 * 예: trackStep("sample:done")
 */
export function trackStep(...names: string[]): void {
  if (typeof window === "undefined") return;
  const already = seen();
  const fresh = names.filter((n) => !already.has(n));
  if (fresh.length === 0) return;
  remember(fresh);
  queue.push(...fresh);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/**
 * 매번 세는 지표 — 그림체·주제처럼 한 사람이 여러 번 고를 수 있는 값.
 * 퍼널 전환율 계산에는 쓰지 않는다.
 */
export function trackEvery(...names: string[]): void {
  if (typeof window === "undefined") return;
  queue.push(...names);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}
