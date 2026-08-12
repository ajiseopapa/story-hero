/**
 * 퍼널 통계 저장소.
 *
 * Upstash Redis의 REST API를 그대로 쓴다(추가 패키지 없음).
 * 키즈텔·정찰병·StaySide와 같은 Upstash 인스턴스를 공유하되 접두사로 분리한다.
 *
 * 개인정보는 저장하지 않는다 — 날짜별 이벤트 카운터뿐이다.
 *
 * 필요한 환경변수 (한 쌍):
 *   KV_REST_API_URL / KV_REST_API_TOKEN               (Vercel KV)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash)
 *   그 밖에 `*_REST_API_URL` + `*_REST_API_TOKEN` 형태면 접두어가 무엇이든 자동 인식한다.
 */

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
  { key: "photo", label: "사진 올림", note: "아이 사진을 넣고 자르기까지 끝냄" },
  { key: "sample:start", label: "샘플 생성 시작", note: "주제까지 고르고 만들기를 누름" },
  { key: "sample:done", label: "샘플 완성", note: "표지+장면을 실제로 봄 — 여기가 감정 최고점" },
  { key: "pay:click", label: "구매 의사", note: "결제/구매 버튼을 누름 — 검증 기간의 핵심 지표" },
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
  { key: "sample:fail", label: "샘플 생성 실패" },
  { key: "share:create", label: "공유 링크 생성" },
];

/** 접두어를 붙여 만들어진 REST 자격증명을 환경변수에서 찾아낸다. */
function findPrefixedRest(): { url: string; token: string } | null {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.endsWith("_REST_API_URL") || !value?.startsWith("http")) continue;
    const token = process.env[`${key.slice(0, -"_URL".length)}_TOKEN`];
    if (token) return { url: value, token };
  }
  return null;
}

function restConfig(): { url: string; token: string } | null {
  const pair =
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
      ? { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN }
      : null) ??
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
      ? {
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
        }
      : null) ??
    findPrefixedRest();

  if (!pair) return null;
  return { url: pair.url.replace(/\/$/, ""), token: pair.token };
}

export function isStoreConfigured(): boolean {
  return restConfig() !== null;
}

/** 인스턴스 메모리 폴백 (개발용 — 배포 환경에서는 유실되므로 대시보드에 경고를 띄운다) */
const memory: Map<string, Map<string, number>> =
  (globalThis as { __kidsbookStats?: Map<string, Map<string, number>> }).__kidsbookStats ??
  new Map();
(globalThis as { __kidsbookStats?: Map<string, Map<string, number>> }).__kidsbookStats = memory;

async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const cfg = restConfig();
  if (!cfg) return [];
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`stats store ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string }[];
  return data.map((d) => d.result ?? null);
}

/** 이벤트 이름은 화이트리스트 문자만 허용해 임의 키 생성이 안 되게 막는다. */
export function isValidEvent(name: unknown): name is string {
  return typeof name === "string" && /^[a-z0-9_:-]{1,48}$/.test(name);
}

export async function track(events: string[]): Promise<void> {
  const valid = events.filter(isValidEvent).slice(0, 10);
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
    const raw = results[i];
    const counts: Record<string, number> = {};
    // Upstash는 HGETALL을 [field, value, ...] 또는 객체로 돌려준다 — 둘 다 처리
    if (Array.isArray(raw)) {
      for (let j = 0; j < raw.length; j += 2) counts[String(raw[j])] = Number(raw[j + 1]) || 0;
    } else if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        counts[k] = Number(v) || 0;
      }
    }
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
