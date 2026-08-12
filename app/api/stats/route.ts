import { isValidEvent, track } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 클라이언트가 보낸 퍼널 이벤트를 집계한다. 개인정보는 저장하지 않고 카운터만 올린다. */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { events?: unknown };
    const events = Array.isArray(body.events) ? body.events.filter(isValidEvent) : [];
    if (events.length === 0) return Response.json({ ok: true, skipped: true });
    await track(events);
    return Response.json({ ok: true });
  } catch {
    // 통계 실패가 사용자 흐름을 막지 않도록 항상 200
    return Response.json({ ok: false });
  }
}
