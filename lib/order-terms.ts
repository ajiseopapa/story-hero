/**
 * 계좌이체 주문 조건 — 서버(lib/orders)와 브라우저(결제 창·관리 화면)가 같이 쓴다.
 * 의존성 없이 순수 계산만 둔다(lib/orders는 node:crypto·KV를 써서 클라이언트에 못 넣는다).
 */

/**
 * 입금 기한(일). 지나면 하루 한 번 도는 크론(/api/share/cleanup)이 "취소"로 바꾼다
 * — 지우지 않는다(퍼널 기록이자, 손님이 뒤늦게 입금하면 관리자가 되살릴 수 있게). 2026-09-05 TK님.
 */
export const PAY_DEADLINE_DAYS = 3;

export function payDeadline(createdAt: number): number {
  return createdAt + PAY_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
}
