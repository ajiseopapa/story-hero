import { consumeQuota, ipBucket } from "@/lib/limits";
import { mailPrintRequest, mailReady } from "@/lib/mail";
import { SITE_ORIGIN } from "@/lib/sharebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTACT_IP_DAILY_LIMIT = Number(process.env.CONTACT_IP_DAILY_LIMIT ?? "5");

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** 인쇄본 제작 신청 접수 — 관리자 메일로 전달한다. */
export async function POST(req: Request): Promise<Response> {
  if (!mailReady()) {
    return Response.json(
      { error: "지금은 신청을 받을 수 없어요. support@kidstel.co.kr로 메일 주세요." },
      { status: 503 },
    );
  }

  let body: {
    name?: unknown;
    contact?: unknown;
    message?: unknown;
    bookTitle?: unknown;
    orderNo?: unknown;
    shareUrl?: unknown;
    kidsInfo?: unknown;
    themeLabel?: unknown;
    artLabel?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const name = clean(body.name, 40);
  const contact = clean(body.contact, 120);
  const message = clean(body.message, 1000);
  const bookTitle = clean(body.bookTitle, 120);
  const orderNo = clean(body.orderNo, 20);
  // 관리자에게 가는 메일에 담기므로 우리 도메인의 공유 링크만 통과시킨다
  const rawShareUrl = clean(body.shareUrl, 300);
  const shareUrl = rawShareUrl.startsWith(`${SITE_ORIGIN}/`) ? rawShareUrl : "";
  const kidsInfo = clean(body.kidsInfo, 200);
  const themeLabel = clean(body.themeLabel, 40);
  const artLabel = clean(body.artLabel, 40);

  if (name.length < 1) {
    return Response.json({ error: "신청하시는 분 이름을 적어주세요." }, { status: 400 });
  }
  if (contact.length < 5) {
    return Response.json(
      { error: "연락 받으실 이메일이나 전화번호를 적어주세요." },
      { status: 400 },
    );
  }

  if (!(await consumeQuota(`contact-${ipBucket(req)}`, CONTACT_IP_DAILY_LIMIT))) {
    return Response.json(
      { error: "오늘은 신청을 더 보낼 수 없어요. 내일 다시 시도해주세요." },
      { status: 429 },
    );
  }

  const sent = await mailPrintRequest({
    name,
    contact,
    message,
    bookTitle,
    orderNo,
    shareUrl,
    kidsInfo,
    themeLabel,
    artLabel,
  });
  if (!sent) {
    return Response.json(
      { error: "전송에 실패했어요. support@kidstel.co.kr로 메일 주시면 확인할게요." },
      { status: 502 },
    );
  }
  return Response.json({ ok: true });
}
