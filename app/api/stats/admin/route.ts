import { EXTRA, FUNNEL, LEAK_EXCLUDE, isStoreConfigured, readStats, sumCounts } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 후기 검수와 같은 키를 쓴다 — 관리자가 외울 키를 늘리지 않는다.
// 쿼리스트링(?key=)은 받지 않는다 — 액세스 로그·브라우저 히스토리·Referer에 남아 유출된다.
function authorized(req: Request): boolean {
  const key = process.env.ADMIN_KEY || process.env.REVIEW_ADMIN_KEY;
  if (!key) return false; // 키를 설정하기 전에는 잠가둔다
  return req.headers.get("x-admin-key") === key;
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "30") || 30, 1), 90);

  const { daily } = await readStats(days);
  const totals = sumCounts(daily);

  // 퍼널: 각 단계 인원 + 직전 단계 대비 전환율
  const steps = FUNNEL.map((s, i) => {
    const count = totals[s.key] ?? 0;
    const prev = i === 0 ? count : (totals[FUNNEL[i - 1].key] ?? 0);
    return {
      ...s,
      count,
      // 직전 단계가 0이면 전환율은 계산 불가 — 0%로 속이지 않고 null
      fromPrev: i === 0 ? null : prev > 0 ? count / prev : null,
      fromTop: (totals[FUNNEL[0].key] ?? 0) > 0 ? count / totals[FUNNEL[0].key] : null,
    };
  });

  // 그림체·주제·아이 수 분포 (접두사별로 모음)
  const breakdown: Record<string, Record<string, number>> = { art: {}, theme: {}, kids: {} };
  for (const [k, v] of Object.entries(totals)) {
    const [group, ...rest] = k.split(":");
    if (group in breakdown && rest.length > 0) breakdown[group][rest.join(":")] = v;
  }

  // 접두사로 갈라 쌓아둔 교차 집계를 푼다(lib/track.ts).
  //  `src:<출처>:<단계>` — 링크에 ?s=... 를 붙인 방문만 쌓인다
  //  `dev:<기기>:<단계>` — 모든 방문이 쌓인다 (ios / aos / pc, 인앱이면 ios-insta 처럼)
  // 단계 이름 자체에 콜론이 있어서(sample:done) 첫 콜론에서만 자른다.
  function cross(prefix: string): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [k, v] of Object.entries(totals)) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const cut = rest.indexOf(":");
      if (cut <= 0) continue;
      (out[rest.slice(0, cut)] ??= {})[rest.slice(cut + 1)] = v;
    }
    return out;
  }
  const sources = cross("src:");
  const devices = cross("dev:");

  return Response.json(
    {
      days,
      configured: isStoreConfigured(),
      steps,
      extra: EXTRA.map((e) => ({ ...e, count: totals[e.key] ?? 0 })),
      breakdown,
      sources,
      devices,
      daily,
      leakExclude: [...LEAK_EXCLUDE],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
