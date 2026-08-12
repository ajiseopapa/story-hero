/**
 * Upstash Redis REST 클라이언트 (추가 패키지 없음).
 * 퍼널 통계(lib/stats.ts)와 계좌이체 주문(lib/orders.ts)이 같이 쓴다.
 *
 * 필요한 환경변수 (한 쌍):
 *   KV_REST_API_URL / KV_REST_API_TOKEN               (Vercel KV)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash)
 *   그 밖에 `*_REST_API_URL` + `*_REST_API_TOKEN` 형태면 접두어가 무엇이든 자동 인식한다.
 */

/** 접두어를 붙여 만들어진 REST 자격증명을 환경변수에서 찾아낸다. */
function findPrefixedRest(): { url: string; token: string } | null {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.endsWith("_REST_API_URL") || !value?.startsWith("http")) continue;
    const token = process.env[`${key.slice(0, -"_URL".length)}_TOKEN`];
    if (token) return { url: value, token };
  }
  return null;
}

export function restConfig(): { url: string; token: string } | null {
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

/** 여러 명령을 한 번에. 저장소가 없으면 빈 배열 — 호출부가 폴백을 정해야 한다. */
export async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
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
  if (!res.ok) throw new Error(`kv ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string }[];
  return data.map((d) => d.result ?? null);
}

/** Upstash는 HGETALL을 [field, value, ...] 또는 객체로 돌려준다 — 둘 다 처리 */
export function toRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1] ?? "");
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = String(v ?? "");
  }
  return out;
}
