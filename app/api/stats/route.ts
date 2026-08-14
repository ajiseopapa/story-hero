import { isValidEvent, kstDate, track } from "@/lib/stats";
import { ipBucket } from "@/lib/limits";
import { pipeline } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// IP 하나가 하루에 올릴 수 있는 이벤트 수. 정상 방문은 세션당 십수 개가 전부다.
// 상한이 없으면 외부인이 pay:done 같은 이벤트를 대량으로 밀어 넣어
// 수요검증의 근거인 퍼널 지표를 통째로 오염시킬 수 있다.
const STATS_IP_DAILY_LIMIT = Number(process.env.STATS_IP_DAILY_LIMIT ?? "200");

async function overIpLimit(req: Request, count: number): Promise<boolean> {
  try {
    const key = `kidsbook:stat-ip:${kstDate()}:${ipBucket(req)}`;
    const [total] = await pipeline([
      ["INCRBY", key, count],
      ["EXPIRE", key, 2 * 24 * 60 * 60],
    ]);
    // 저장소가 없으면(로컬 개발) 제한하지 않는다
    return total !== undefined && Number(total) > STATS_IP_DAILY_LIMIT;
  } catch {
    return false; // 카운터 장애가 통계 수집까지 막을 필요는 없다
  }
}

/** 클라이언트가 보낸 퍼널 이벤트를 집계한다. 개인정보는 저장하지 않고 카운터만 올린다. */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { events?: unknown };
    const events = Array.isArray(body.events) ? body.events.filter(isValidEvent) : [];
    if (events.length === 0) return Response.json({ ok: true, skipped: true });
    // 상한 초과 IP는 조용히 무시한다 — 오염 시도에 "막혔다"는 신호를 줄 필요가 없다
    if (await overIpLimit(req, events.length)) return Response.json({ ok: true });
    await track(events);
    return Response.json({ ok: true });
  } catch {
    // 통계 실패가 사용자 흐름을 막지 않도록 항상 200
    return Response.json({ ok: false });
  }
}
