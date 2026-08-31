/**
 * 메타(페이스북·인스타그램) 광고 픽셀.
 *
 * 인스타 광고를 켜면 메타는 "결제까지 가는 사람"을 찾아 광고를 보여주는데, 그러려면
 * 어디까지 갔는지를 픽셀로 돌려줘야 한다. 광고를 켜기 전에 미리 깔아두면 그때까지
 * 쌓인 방문이 학습 모수가 되므로, 켜는 날 최적화가 처음부터 돌아간다.
 *
 * 넘기는 값은 **단계 이름과 금액뿐**이다. 아이의 사진·이름·나이는 절대 보내지 않는다
 * (개인정보처리방침 4항의 "아동 정보를 광고 목적으로 이용하지 않는다"와 맞물려 있다).
 *
 * NEXT_PUBLIC_META_PIXEL_ID가 비어 있으면 layout이 스크립트 자체를 넣지 않고,
 * 여기 함수들도 전부 조용히 아무 일도 하지 않는다 — 로컬·프리뷰에서 광고 데이터가
 * 더러워지지 않게 하려는 것이다.
 */
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";

/** 주문 금액을 모르는 자리(계좌이체 접수 등)에서 쓰는 기본값 — 화면에 띄우는 가격과 같다. */
export const META_PRICE = Number(process.env.NEXT_PUBLIC_PRICE ?? "14900");

/**
 * 퍼널 단계 → 메타 표준 이벤트.
 *
 * 표준 이벤트 이름을 써야 광고 관리자에서 그대로 "전환 목적"으로 고를 수 있다.
 * 커스텀 이벤트는 맞춤 전환을 따로 만들어야 해서 손이 더 간다.
 *
 * visit은 넣지 않았다 — PageView로 이미 잡힌다.
 */
const STEP_EVENTS: Record<string, { name: string; params?: Record<string, unknown> }> = {
  // 사진까지 올린 사람 = 그냥 스쳐간 방문자와 갈린다.
  // Lead(sample:done)는 '판매' 목표 캠페인에서 최적화 대상으로 못 고르게 막혀 있어서,
  // 광고를 켜는 동안은 이 ViewContent가 실질적인 최적화 신호 노릇을 한다. (2026-08-26)
  photo: { name: "ViewContent" },
  "sample:start": { name: "CustomizeProduct" },
  // 무료 샘플을 실제로 본 순간. 카드결제를 열기 전까지는 이게 광고 최적화의 1차 목표다.
  "sample:done": { name: "Lead" },
  "pay:click": { name: "InitiateCheckout", params: { value: META_PRICE, currency: "KRW" } },
  // 이어보기로 돌아와 누른 것도 광고에는 같은 신호다 — 퍼널에서만 갈라 센다.
  "pay:click:resume": {
    name: "InitiateCheckout",
    params: { value: META_PRICE, currency: "KRW" },
  },
};

type FbqFn = (...args: unknown[]) => void;

function getFbq(): FbqFn | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { fbq?: FbqFn }).fbq;
  return typeof fn === "function" ? fn : null;
}

/**
 * 메타 표준 이벤트를 직접 보낸다.
 * 주문 접수·결제 완료처럼 서버에서 세느라 track.ts를 거치지 않는 자리에서 쓴다.
 */
export function metaTrack(name: string, params?: Record<string, unknown>): void {
  const fbq = getFbq();
  if (!fbq) return;
  try {
    fbq("track", name, params ?? {});
  } catch {
    // 광고 추적이 실패해도 사용자 흐름은 절대 막지 않는다
  }
}

/** 퍼널 단계 이름으로 보내기 — 매핑에 없는 단계는 조용히 무시한다. */
export function metaTrackStep(step: string): void {
  const event = STEP_EVENTS[step];
  if (event) metaTrack(event.name, event.params);
}
