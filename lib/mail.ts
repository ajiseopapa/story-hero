/**
 * 주문 관련 자동 메일.
 *
 * SMTP 설정(SMTP_USER·SMTP_PASS)이 없으면 조용히 건너뛴다 — 메일 실패가
 * 주문 접수나 입금 확인 처리를 되돌리면 안 되기 때문에 모든 발송은 fail-open.
 * 기본값은 하이웍스 SMTP (kidstel.co.kr 메일이 하이웍스 호스팅).
 */
import nodemailer from "nodemailer";

const HOST = process.env.SMTP_HOST ?? "smtps.hiworks.com";
const PORT = Number(process.env.SMTP_PORT ?? "465");
const USER = process.env.SMTP_USER; // 예: support@kidstel.co.kr
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM ?? USER;
const ADMIN = process.env.MAIL_ADMIN ?? USER; // 새 주문 알림 받을 주소
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

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!mailReady()) return;
  try {
    const transport = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
    });
    await transport.sendMail({ from: `"키즈북" <${FROM}>`, to, subject, html });
  } catch (err) {
    console.warn("mail send failed (fail-open):", err);
  }
}

const WRAP = (inner: string) =>
  `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#3d3229">
${inner}
<p style="margin-top:28px;font-size:12px;color:#9a8c7c">키즈북 · <a href="${SITE}" style="color:#9a8c7c">story.kidstel.co.kr</a> · 문의 support@kidstel.co.kr</p>
</div>`;

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
<p>혹시 화면이 그대로라면 페이지를 새로고침해 주세요.</p>`),
  );
}
