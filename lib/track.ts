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
const DEV_KEY = "kidsbook:dev";
const MUTE_KEY = "kidsbook:notrack";
const SRC_KEY = "kidsbook:src";
const REF_KEY = "kidsbook:ref";
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

/**
 * 유입 링크의 **호스트만** 남긴다 — `?s=` 꼬리표가 없는 링크로 들어온 사람도
 * 어디서 왔는지 읽히게. 경로·쿼리는 버린다(개인정보가 섞일 수 있다).
 *
 * 첫 방문 때 한 번 잡아 세션 내내 유지한다. 사이트 안에서 새로고침하면
 * referrer가 우리 주소로 바뀌어 원래 유입처가 지워지기 때문이다.
 * 빈 값도 저장한다 — "직접 들어왔다"를 나중에 우리 주소로 덮어쓰지 않도록.
 */
function referrer(): string {
  try {
    const saved = sessionStorage.getItem(REF_KEY);
    if (saved !== null) return saved;
    let host = "";
    try {
      const url = new URL(document.referrer);
      if (url.host && url.host !== window.location.host) {
        host = url.host.toLowerCase().replace(/^www\./, "").slice(0, 40);
      }
    } catch {
      /* referrer가 비었거나 주소가 아니면 빈 값 */
    }
    sessionStorage.setItem(REF_KEY, host);
    return host;
  } catch {
    return "";
  }
}

/** 인앱 브라우저 판별 — UA에 자기 이름을 남기는 앱들. 스레드가 인스타 이름을 함께 달고 나와 순서가 중요하다. */
const IN_APP: [RegExp, string][] = [
  [/Threads|Barcelona/i, "threads"],
  [/Instagram/i, "insta"],
  [/KAKAOTALK/i, "kakao"],
  [/FBAN|FBAV|FB_IAB/i, "fb"],
  [/NAVER\(inapp/i, "naver"],
  [/DaumApps/i, "daum"],
  [/\bLine\//i, "line"],
];

/**
 * 기기 꼬리표 — 출처와 같은 방식으로 `dev:<기기>:<단계>` 를 단계마다 하나씩 더 쌓는다.
 *
 * 왜 필요한가: 방문 170명 중 사진을 올린 사람이 8명뿐인데(2026-09-01 집계), 인스타·카톡
 * 인앱 브라우저는 파일 선택 자체가 막히거나 곧바로 닫히는 일이 흔하다. 기기별로 갈라 보지
 * 않으면 "사람들이 관심이 없다"와 "그 브라우저에선 아예 못 올린다"를 구별할 수 없다.
 *
 * 값은 `ios`·`aos`·`pc`, 인앱이면 `ios-insta`처럼 앱 이름을 붙인다.
 * UA 문자열에서 이 분류값만 뽑아 보낸다 — UA 원문이나 개인을 식별하는 값은 남기지 않는다.
 * 판별은 순수 함수(deviceBucket)로 빼둔다 — 브라우저 없이 UA 문자열만으로 검증할 수 있게.
 */
export function deviceBucket(ua: string): string {
  const plat = /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "aos" : "pc";
  let app = IN_APP.find(([re]) => re.test(ua))?.[1] ?? "";
  // 이름을 안 밝히는 인앱 웹뷰: 안드로이드는 UA에 `; wv)`, 아이폰은 Safari 토큰이 없다.
  if (!app && (/;\s*wv\)/i.test(ua) || (plat === "ios" && !/Safari/i.test(ua)))) app = "inapp";
  return app ? `${plat}-${app}` : plat;
}

function device(): string {
  try {
    const saved = sessionStorage.getItem(DEV_KEY);
    if (saved) return saved;
  } catch {
    /* 저장소가 막히면 매번 다시 계산한다 — 값은 같다 */
  }
  const bucket = deviceBucket(navigator.userAgent || "");
  try {
    sessionStorage.setItem(DEV_KEY, bucket);
  } catch {
    /* 못 저장해도 다음 호출에서 같은 값이 나온다 */
  }
  return bucket;
}

/**
 * 주문 기록에 붙일 유입 정보 — 퍼널 꼬리표(`?s=`)와 유입 링크 호스트.
 * 둘 다 세션 첫 화면에서 굳어진 값이라, 주문서까지 왔을 때도 처음 들어온 경로를 가리킨다.
 */
export function entrySource(): { source: string; referrer: string } {
  if (typeof window === "undefined") return { source: "", referrer: "" };
  return { source: source(), referrer: referrer() };
}

/**
 * 이 브라우저의 이벤트를 집계에서 뺀다.
 *
 * 테스트 통행증 링크(/api/test-pass)로 들어오면 홈 주소에 ?test=1이 붙는다. 그 표식을
 * 이 브라우저에 남겨, 내가 인앱 브라우저를 확인하며 만든 방문·클릭이 운영 퍼널에 섞이지
 * 않게 한다 — 숫자를 근거로 판단하려면 내 테스트가 들어가면 안 된다(2026-09-01).
 * ?test=0 으로 다시 켠다.
 */
function muted(): boolean {
  try {
    const flag = new URLSearchParams(window.location.search).get("test");
    if (flag === "1") localStorage.setItem(MUTE_KEY, "1");
    if (flag === "0") localStorage.removeItem(MUTE_KEY);
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false; // 저장소가 막힌 브라우저는 평소대로 집계한다
  }
}

let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * 저장소가 막혔을 때의 폴백.
 *
 * 예전엔 sessionStorage가 막히면 중복 제거를 통째로 포기했다. 그래서 인앱 브라우저·시크릿
 * 모드에서는 구매 버튼을 누를 때마다 pay:click이 새로 쌓였고, 잠금 오버레이가 페이지마다
 * 뜨는 탓에 한 사람이 열 번도 넘게 세어질 수 있었다 (2026-08-30: 샘플 완성 4인데 구매 의사 13).
 *
 * 이 Set은 페이지가 살아 있는 동안만 유지된다 — 새로고침하면 사라지므로 세션 단위 정확도까지
 * 되찾지는 못한다. 다만 "같은 화면에서 여러 번 누른 것"은 확실히 한 번으로 접는다.
 */
const memorySeen = new Set<string>();

function seen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    const set = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    memorySeen.forEach((n) => set.add(n));
    return set;
  } catch {
    return new Set(memorySeen);
  }
}

function remember(names: string[]): void {
  names.forEach((n) => memorySeen.add(n)); // 저장소가 막혀도 이건 언제나 남는다
  try {
    const set = seen();
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...set]));
  } catch {
    /* 저장 못 해도 memorySeen이 이번 페이지의 중복은 막는다 */
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
  if (typeof window === "undefined" || muted()) return;
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
  referrer(); // 첫 화면에서 유입 링크를 굳혀둔다 — 나중엔 우리 주소로 바뀐다
  if (src) queue.push(...fresh.map((n) => `src:${src}:${n}`));
  // 기기별로도 같은 단계를 쌓는다. 전체 퍼널은 그대로 두고 곁에 하나 더 남기는 것이라 숫자가 어긋나지 않는다.
  const dev = device();
  if (dev) queue.push(...fresh.map((n) => `dev:${dev}:${n}`));
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/**
 * 매번 세는 지표 — 그림체·주제처럼 한 사람이 여러 번 고를 수 있는 값.
 * 퍼널 전환율 계산에는 쓰지 않는다.
 */
export function trackEvery(...names: string[]): void {
  if (typeof window === "undefined" || muted()) return;
  queue.push(...names);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}
