/**
 * 퍼널 통계 저장소.
 *
 * 키즈텔·정찰병·StaySide와 같은 Upstash 인스턴스를 공유하되 접두사로 분리한다.
 * 개인정보는 저장하지 않는다 — 날짜별 이벤트 카운터뿐이다.
 */
import { isStoreConfigured, pipeline, restConfig, toRecord } from "@/lib/kv";

export { isStoreConfigured };

const PREFIX = "kidsbook:stat:";
const RETENTION_DAYS = 180;

/** 하루 단위 집계 키는 한국 시간 기준으로 끊는다. */
export function kstDate(offsetDays = 0): string {
  const t = Date.now() + 9 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * 퍼널 단계 — 순서가 곧 화면에 그려지는 순서다.
 * 각 단계는 브라우저 세션당 한 번만 센다(lib/track.ts). 즉 값은 "사람 수"에 가깝다.
 */
export const FUNNEL: { key: string; label: string; note: string }[] = [
  { key: "visit", label: "방문", note: "첫 화면에 도착" },
  {
    key: "photo:open",
    label: "사진 선택창 엶",
    note: "사진 올리기를 눌러 파일 선택창을 띄움 — 여기서 다음 칸으로 못 넘어가면 브라우저가 막은 것이다",
  },
  {
    key: "photo:pick",
    label: "사진 고름",
    note: "선택창에서 사진이 실제로 넘어옴. 끌어다 놓기로 올리면 선택창 없이 여기부터 잡힌다",
  },
  { key: "photo", label: "사진 올림", note: "자르기까지 끝냄 — 여기서 새면 자르기 화면 문제다" },
  { key: "sample:start", label: "샘플 생성 시작", note: "주제까지 고르고 만들기를 누름" },
  { key: "sample:done", label: "샘플 완성", note: "표지+장면을 실제로 봄 — 여기가 감정 최고점" },
  {
    key: "pay:click",
    label: "구매 의사",
    note: "방금 만든 샘플을 보고 결제/구매를 누름 — 검증 기간의 핵심 지표",
  },
  {
    key: "pay:done",
    label: "카드 결제 완료",
    note: "토스 카드결제만 잡힙니다. 계좌이체는 수동 확인이라 여기 안 올라와요",
  },
];

/**
 * "가장 크게 새는 곳" 계산에서 빼는 단계.
 * 카드 결제는 아직 열지 않아서 항상 0이다 — 이건 고칠 이탈이 아니라 사업 결정이라,
 * 넣어두면 매번 여기를 지목해서 진짜 새는 구간을 가린다.
 */
export const LEAK_EXCLUDE = new Set(["pay:done"]);

/** 퍼널 밖 참고 지표 — 이탈 원인·비용 추적용 */
export const EXTRA: { key: string; label: string }[] = [
  { key: "order:submit", label: "계좌이체 주문 접수" },
  // 지난 동화 '이어서 보기'·결제 복귀로 책을 연 사람의 구매 클릭.
  // 퍼널에 넣지 않는다 — 이 사람들은 이번 세션에 샘플을 만들지 않았으므로
  // 직전 단계(샘플 완성) 대비 전환율에 섞이면 200% 같은 숫자가 나온다.
  { key: "pay:click:resume", label: "구매 의사(이어보기·복귀)" },
  { key: "sample:fail", label: "샘플 생성 실패" },
  { key: "share:create", label: "공유 링크 생성" },
  // 공유 책(/book/…)이 바이럴 루프로 얼마나 일하는지 — 열람 → 재공유·카드 → 새 방문(src:book:visit)
  { key: "book:view", label: "공유 책 열람" },
  { key: "book:share", label: "공유 책에서 다시 공유" },
  { key: "book:card", label: "인스타 자랑 카드 저장" },
];

/** 인스턴스 메모리 폴백 (개발용 — 배포 환경에서는 유실되므로 대시보드에 경고를 띄운다) */
const memory: Map<string, Map<string, number>> =
  (globalThis as { __kidsbookStats?: Map<string, Map<string, number>> }).__kidsbookStats ??
  new Map();
(globalThis as { __kidsbookStats?: Map<string, Map<string, number>> }).__kidsbookStats = memory;

/** 이벤트 이름은 화이트리스트 문자만 허용해 임의 키 생성이 안 되게 막는다. */
export function isValidEvent(name: unknown): name is string {
  return typeof name === "string" && /^[a-z0-9_:-]{1,48}$/.test(name);
}

/**
 * 이 실행 환경의 이벤트를 실제 지표로 셀지 여부.
 *
 * 로컬 dev 서버가 .env.local의 **운영 KV**를 그대로 쓰기 때문에, 개발하며 페이지를 열 때마다
 * 방문이 운영 퍼널에 쌓였다. 수요검증의 근거로 쓰는 숫자에 내 테스트가 섞이면
 * "방문 59, 사진 0"이 무슨 뜻인지 영영 읽을 수 없다 (2026-08-26).
 *
 * 프리뷰 배포(VERCEL_ENV=preview)도 같은 이유로 세지 않는다.
 */
function countable(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production";
}

export async function track(events: string[]): Promise<void> {
  if (!countable()) return;
  // 한 단계마다 전체·출처별·기기별 세 벌이 쌓이므로 상한이 10이면 조용히 잘려나갔다.
  const valid = events.filter(isValidEvent).slice(0, 30);
  if (valid.length === 0) return;
  const day = kstDate();
  const key = PREFIX + day;

  if (!restConfig()) {
    const bucket = memory.get(day) ?? new Map<string, number>();
    valid.forEach((e) => bucket.set(e, (bucket.get(e) ?? 0) + 1));
    memory.set(day, bucket);
    return;
  }

  await pipeline([
    ...valid.map((e) => ["HINCRBY", key, e, 1]),
    ["EXPIRE", key, RETENTION_DAYS * 24 * 60 * 60],
  ]);
}

export interface DayStats {
  date: string;
  counts: Record<string, number>;
}

export async function readStats(days = 30): Promise<{
  configured: boolean;
  daily: DayStats[];
}> {
  const dates = Array.from({ length: days }, (_, i) => kstDate(i)).reverse();

  if (!restConfig()) {
    return {
      configured: false,
      daily: dates.map((date) => ({
        date,
        counts: Object.fromEntries(memory.get(date) ?? new Map()),
      })),
    };
  }

  const results = await pipeline(dates.map((d) => ["HGETALL", PREFIX + d]));
  const daily = dates.map((date, i) => {
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(toRecord(results[i]))) counts[k] = Number(v) || 0;
    return { date, counts };
  });

  return { configured: true, daily };
}

/** 여러 날짜의 이벤트 합계 */
export function sumCounts(daily: DayStats[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const d of daily) {
    for (const [k, v] of Object.entries(d.counts)) total[k] = (total[k] ?? 0) + v;
  }
  return total;
}
