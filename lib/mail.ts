/**
 * 메일 발송 (Gmail SMTP + 앱 비밀번호).
 *
 * 쓰는 곳: ① 새 계좌이체 주문 → 관리자 알림 ② 입금 확인 → 주문자 안내
 * ③ 보관 링크 완성 → 주문자에게 링크 전달.
 *
 * SMTP_USER/SMTP_PASS가 없으면 조용히 건너뛴다 — 메일은 보조 수단이고,
 * 발송 실패가 주문 접수나 결제 승인을 되돌리면 안 된다. 호출부는 try/catch로 감쌀 것.
 */
import nodemailer from "nodemailer";

const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;

// 주문 알림을 받을 관리자 주소 (기본은 발신 계정 자신)
export const NOTIFY_EMAIL = process.env.ORDER_NOTIFY_EMAIL || USER || "";

export function mailReady(): boolean {
  return !!(USER && PASS);
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!mailReady() || !to) return;
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: USER, pass: PASS },
  });
  await transport.sendMail({
    from: `"키즈북" <${USER}>`,
    to,
    subject,
    text,
  });
}
