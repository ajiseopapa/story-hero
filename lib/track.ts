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

import { metaTrackStep } from "@/lib/meta-pixel";

const SEEN_KEY = "kidsbook:tracked";
const SRC_KEY = "kidsbook:src";
const FLUSH_MS = 400;

/**
 * 유입 출처 — 링크에 `?s=reel1` 을 붙여서 뿌리면 그 이름으로 퍼널이 따로 쌓인다.
 * 릴스·게시물마다 다른 이름을 주면 무엇이 실제로 사람을 데려왔는지 갈라 볼 수 있다.
 *
 * 한 번 잡은 출처는 세션이 끝날 때까지 유지한다 — 사람이 페이지를 옮겨 다녀도
 * 파라미터가 사라진 뒤의 단계까지 같은 출처로 따라붙어야 퍼널이 성립한다.
 * 빈 출처는 굳히지 않는다 — 공유 책(/book/…)에서 이벤트를 먼저 찍고
 * `/?s=book` CTA로 넘어오는 사람의 꼬리표가 지워지면 안 되기 때문이다.
 * 값은 소문자·숫자·하이픈 16자로 깎는다(서버 이벤트 이름 규칙에 맞추기 위해서다).
 */
function source(): string {
  try {
    const saved = sessionStorage.getItem(SRC_KEY);
    if (saved) return saved;
    const raw = new URLSearchParams(window.location.search).get("s") ?? "";
    const clean = raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 16);
    if (clean) sessionStorage.setItem(SRC_KEY, clean);
    return clean;
  } catch {
    return ""; // sessionStorage가 막히면 출처 없이 전체 집계만 남긴다
  }
}

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
  // 광고 픽셀에도 같은 단계를 흘린다 — 세션당 한 번 규칙을 여기서 같이 얻는다
  fresh.forEach(metaTrackStep);
  // 출처가 있으면 같은 단계를 출처별로도 쌓는다. 전체 퍼널은 그대로 두고 곁에 하나 더 남기는 것이라
  // 꼬리표를 안 붙인 방문이 섞여도 전체 숫자는 어긋나지 않는다.
  const src = source();
  if (src) queue.push(...fresh.map((n) => `src:${src}:${n}`));
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
