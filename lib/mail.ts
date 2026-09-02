/**
 * 주문 관련 자동 메일.
 *
 * SMTP 설정(SMTP_USER·SMTP_PASS)이 없으면 조용히 건너뛴다 — 메일 실패가
 * 주문 접수나 입금 확인 처리를 되돌리면 안 되기 때문에 모든 발송은 fail-open.
 * 기본값은 하이웍스 SMTP (kidstel.co.kr 메일이 하이웍스 호스팅).
 */
import nodemailer from "nodemailer";

// 대시보드에서 붙여넣을 때 끝에 공백·줄바꿈이 딸려 들어와 인증이 깨지는 일이 잦아 trim한다
const HOST = (process.env.SMTP_HOST ?? "smtps.hiworks.com").trim();
const PORT = Number((process.env.SMTP_PORT ?? "465").trim());
const USER = process.env.SMTP_USER?.trim(); // 예: support@kidstel.co.kr
const PASS = process.env.SMTP_PASS?.trim();
const FROM = process.env.MAIL_FROM?.trim() ?? USER;
const ADMIN = process.env.MAIL_ADMIN?.trim() ?? USER; // 새 주문 알림 받을 주소
const BANK_ACCOUNT = process.env.NEXT_PUBLIC_BANK_ACCOUNT ?? "";
const SITE = "https://story.kidstel.co.kr";

export function mailReady(): boolean {
  return Boolean(USER && PASS);
}

// 이름·책 제목은 손님이 입력한 값이라 HTML로 해석되면 안 된다
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  if (!mailReady()) return false;
  try {
    const transport = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
    });
    await transport.sendMail({ from: `"키즈북" <${FROM}>`, to, subject, html });
    return true;
  } catch (err) {
    // 원인 추적용: 어떤 계정·서버로 시도했는지 남긴다 (비밀번호는 길이만)
    console.warn(
      `mail send failed (fail-open) [host=${HOST}:${PORT} user=${USER} passLen=${PASS?.length ?? 0}]:`,
      err,
    );
    return false;
  }
}

const WRAP = (inner: string) =>
  `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#3d3229">
${inner}
<p style="margin-top:28px;font-size:12px;color:#9a8c7c">키즈북 · <a href="${SITE}" style="color:#9a8c7c">story.kidstel.co.kr</a> · 문의 support@kidstel.co.kr</p>
</div>`;

/**
 * 서비스가 멈추는 사고 알림 (크레딧 소진·키 오류 등). 발송 실패는 삼킨다 — 이 메일 때문에
 * 손님 응답이 늦어지면 안 된다. 잦은 재발송은 호출부(lib/alerts.ts)가 막는다.
 */
export async function mailAdminAlert(subject: string, body: string): Promise<void> {
  if (!ADMIN) return;
  await send(
    ADMIN,
    `[키즈북 ⚠️] ${subject}`,
    WRAP(`<h2 style="font-size:18px">${esc(subject)}</h2>
<p style="white-space:pre-wrap">${esc(body)}</p>
<p><a href="${SITE}/admin/funnel">퍼널 지표 보기</a></p>`),
  );
}

/** 주문 접수 직후 손님에게: 주문번호와 입금 계좌 안내 */
export async function mailOrderReceived(o: {
  email: string;
  name: string;
  bookTitle: string;
  amount: number;
  orderNo: string;
}): Promise<void> {
  const bank = BANK_ACCOUNT
    ? `<p style="background:#f7efe2;padding:14px 16px;border-radius:10px">아래 계좌로 <b>${o.amount.toLocaleString()}원</b>을 보내주세요.<br/><b style="font-size:16px">${esc(BANK_ACCOUNT)}</b></p>`
    : `<p>입금 계좌를 곧 이 주소로 안내드릴게요.</p>`;
  await send(
    o.email,
    `[키즈북] 주문이 접수됐어요 (주문번호 ${o.orderNo})`,
    WRAP(`<h2 style="font-size:18px">주문이 접수됐어요 📚</h2>
<p>${esc(o.name)}님, 《 ${esc(o.bookTitle)} 》 주문이 접수됐습니다.<br/>주문번호는 <b>${o.orderNo}</b>예요.</p>
${bank}
<p>입금이 확인되면 이 주소로 다시 알려드릴게요. 보통 몇 시간 안에 확인됩니다.</p>`),
  );
}

/** 주문 접수 직후 관리자에게: 새 주문 알림 */
export async function mailAdminNewOrder(o: {
  name: string;
  email: string;
  bookTitle: string;
  amount: number;
  orderNo: string;
}): Promise<void> {
  if (!ADMIN) return;
  await send(
    ADMIN,
    `[키즈북] 새 주문 ${o.orderNo} · ${o.name} · ${o.amount.toLocaleString()}원`,
    WRAP(`<h2 style="font-size:18px">새 계좌이체 주문</h2>
<p>주문번호 <b>${o.orderNo}</b><br/>입금자명 <b>${esc(o.name)}</b><br/>이메일 ${esc(o.email)}<br/>책 제목 《 ${esc(o.bookTitle)} 》<br/>금액 <b>${o.amount.toLocaleString()}원</b></p>
<p>입금을 확인했으면 <a href="${SITE}/admin/orders">관리자 화면</a>에서 "입금 확인"을 눌러주세요.</p>`),
  );
}

/**
 * 인쇄본 제작 신청 — 관리자에게 전달. mailto 링크는 메일 앱이 없는 기기에서
 * 에러가 나서, 화면 안 폼으로 받아 서버가 대신 보낸다.
 * 이 메일은 발송 자체가 목적이라 성공 여부를 돌려준다 (주문 메일과 달리 fail-open이면 안 됨).
 */
export async function mailPrintRequest(o: {
  name: string;
  contact: string;
  message?: string;
  bookTitle?: string;
  orderNo?: string;
  shareUrl?: string;
  kidsInfo?: string;
  themeLabel?: string;
  artLabel?: string;
}): Promise<boolean> {
  if (!ADMIN) return false;
  const rows = [
    `신청자 <b>${esc(o.name)}</b>`,
    `연락처 <b>${esc(o.contact)}</b>`,
    o.bookTitle && `책 제목 《 ${esc(o.bookTitle)} 》`,
    o.kidsInfo && `아이 ${esc(o.kidsInfo)}`,
    o.themeLabel && `주제 ${esc(o.themeLabel)}`,
    o.artLabel && `그림체 ${esc(o.artLabel)}`,
    o.orderNo && `주문번호 <b>${esc(o.orderNo)}</b>`,
    o.shareUrl
      ? `책 보기(인쇄 원본) <a href="${esc(o.shareUrl)}">${esc(o.shareUrl)}</a>`
      : `⚠️ 공유 링크 없음 — 인쇄 원본을 받으려면 손님에게 공유 링크 생성을 요청해야 해요`,
  ].filter(Boolean);
  return send(
    ADMIN,
    `[책 제작 요청] ${o.bookTitle ? `《 ${esc(o.bookTitle)} 》 · ` : ""}${esc(o.name)}`,
    WRAP(`<h2 style="font-size:18px">인쇄본 1차 제작 신청</h2>
<p>${rows.join("<br/>")}</p>
${o.message ? `<p style="background:#f7efe2;padding:12px 14px;border-radius:10px;white-space:pre-wrap">${esc(o.message)}</p>` : ""}`),
  );
}

/** 입금 확인 처리 시 손님에게: 책이 열렸다는 안내 */
export async function mailOrderPaid(o: {
  email: string;
  name: string;
  bookTitle: string;
  orderNo: string;
}): Promise<void> {
  await send(
    o.email,
    `[키즈북] 입금 확인 완료 — 동화책이 열렸어요 (주문번호 ${o.orderNo})`,
    WRAP(`<h2 style="font-size:18px">입금이 확인됐어요 ✨</h2>
<p>${esc(o.name)}님, 《 ${esc(o.bookTitle)} 》 결제가 완료됐습니다.</p>
<p><b>책을 만들던 그 기기·브라우저로</b> <a href="${SITE}">키즈북</a>에 다시 들어오시면 나머지 장면 생성과 PDF·소리책이 모두 열립니다.</p>
<p>혹시 화면이 그대로라면 페이지를 새로고침해 주세요.</p>
<p>책이 완성되면 1년간 언제든 다시 열 수 있는 <b>보관 링크</b>도 이 주소로 보내드릴게요.</p>`),
  );
}

/** 무료 쿠폰 사용 직후 손님에게: 책이 열렸다는 안내. 입금 확인 메일의 쿠폰판이다 —
 *  결제한 사람과 같은 길을 타므로 "그 기기·브라우저로 돌아오라"는 말이 똑같이 필요하다. */
export async function mailCouponUsed(o: {
  email: string;
  name: string;
  bookTitle: string;
  orderNo: string;
  code: string;
}): Promise<void> {
  await send(
    o.email,
    `[키즈북] 쿠폰이 적용됐어요 — 동화책이 열렸어요 (주문번호 ${o.orderNo})`,
    WRAP(`<h2 style="font-size:18px">쿠폰이 적용됐어요 🎁</h2>
<p>${esc(o.name)}님, 쿠폰 <b>${esc(o.code)}</b>으로 《 ${esc(o.bookTitle)} 》 한 권이 열렸습니다.<br/>주문번호는 <b>${o.orderNo}</b>예요.</p>
<p><b>책을 만들던 그 기기·브라우저로</b> <a href="${SITE}">키즈북</a>에 다시 들어오시면 나머지 장면 생성과 PDF·소리책이 모두 열립니다.</p>
<p>혹시 화면이 그대로라면 페이지를 새로고침해 주세요.</p>
<p>책이 완성되면 1년간 언제든 다시 열 수 있는 <b>보관 링크</b>도 이 주소로 보내드릴게요.</p>`),
  );
}

/** 무료 쿠폰 사용 직후 관리자에게: 누가 어떤 코드를 썼는지 */
export async function mailAdminCouponUsed(o: {
  name: string;
  email: string;
  bookTitle: string;
  orderNo: string;
  code: string;
  used: number;
  maxUses: number;
}): Promise<void> {
  if (!ADMIN) return;
  await send(
    ADMIN,
    `[키즈북] 쿠폰 사용 ${o.code} · ${o.name} (${o.used}/${o.maxUses})`,
    WRAP(`<h2 style="font-size:18px">무료 쿠폰이 쓰였어요</h2>
<p>쿠폰 <b>${esc(o.code)}</b> (${o.used}/${o.maxUses}번째)<br/>이름 <b>${esc(o.name)}</b><br/>이메일 ${esc(o.email)}<br/>책 제목 《 ${esc(o.bookTitle)} 》<br/>주문번호 <b>${o.orderNo}</b></p>
<p><a href="${SITE}/admin/coupons">쿠폰 관리</a> · <a href="${SITE}/admin/orders">주문 목록</a></p>`),
  );
}

/** 책 완성 후 손님에게: 1년 보관 링크 전달 (기기가 바뀌어도 이 링크로 다시 연다).
 *  성공 여부를 돌려준다 — 호출부가 "보냈음" 표식을 성공했을 때만 남겨 재시도가 가능하게. */
export async function mailBookLink(o: {
  email: string;
  name: string;
  bookTitle: string;
  url: string;
}): Promise<boolean> {
  return send(
    o.email,
    `[키즈북] 동화책 보관 링크 — 《 ${esc(o.bookTitle)} 》`,
    WRAP(`<h2 style="font-size:18px">동화책이 완성됐어요 📖</h2>
<p>${esc(o.name)}님, 아래 링크는 <b>1년간 보관</b>되는 우리 아이 동화책이에요.</p>
<p style="background:#f7efe2;padding:14px 16px;border-radius:10px"><a href="${esc(o.url)}" style="font-size:15px;word-break:break-all">${esc(o.url)}</a></p>
<p>폰을 바꾸거나 브라우저 기록이 지워져도 이 링크로 언제든 다시 열 수 있으니 <b>이 메일을 보관해주세요</b>. 가족에게 링크를 그대로 공유하셔도 됩니다.</p>
<p>아이와 즐거운 밤 되세요 💛</p>`),
  );
}
