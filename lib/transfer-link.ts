/**
 * 계좌이체 손님을 송금 앱으로 바로 보내는 링크.
 *
 * ⭐ 왜 필요한가(2026-09-07 퍼널): 결제 버튼을 누른 17명 중 주문서를 낸 사람은 3명뿐이고,
 *    그 3명 중 2명은 입금 없이 기한이 지나 자동 취소됐다. 계좌번호를 복사해 은행 앱을
 *    따로 열고 돌아오는 그 사이에서 손님이 사라진다. 토스 송금 화면은 은행·계좌·금액을
 *    채운 채로 열 수 있고, 개인 간 송금이라 수수료도 결제대행 계약도 없다.
 *
 * ⚠️ 카카오페이·카카오뱅크는 계좌를 지정해 송금 화면을 여는 공개 스킴이 없어 넣지 않았다.
 *    (문서화된 건 `kakaotalk://kakaopay/...` 같은 화면 이동뿐 — 계좌·금액을 못 넘긴다.)
 * ⚠️ 커스텀 스킴은 안드로이드 크롬에서 링크 클릭으로 열리지 않는다 — intent:// 로 감싼다.
 *    토스가 안 깔려 있으면 intent가 알아서 플레이스토어로 보낸다(package 지정의 기본 동작).
 */

/** 토스 안드로이드 패키지명 — intent:// 로 열 때 필요하다 */
const TOSS_ANDROID_PACKAGE = "viva.republica.toss";

export interface BankAccount {
  /** 은행 이름 (예: 카카오뱅크) */
  bank: string;
  /** 계좌번호 — 하이픈을 뺀 숫자만 (송금 앱에 넘기는 값) */
  accountNo: string;
  /** 예금주 등 뒤에 붙은 나머지. 없을 수 있다 */
  holder: string;
}

/**
 * `NEXT_PUBLIC_BANK_ACCOUNT`("카카오뱅크 3333-38-1404290 키즈텔(키즈북)")를 쪼갠다.
 * 형식이 다르면 null — 그러면 화면은 송금 버튼 없이 계좌번호만 보여준다.
 */
export function parseBankAccount(raw: string): BankAccount | null {
  const m = /^\s*(\S+)\s+([\d-]{8,})\s*(.*?)\s*$/.exec(raw ?? "");
  if (!m) return null;
  const accountNo = m[2].replace(/\D/g, "");
  if (accountNo.length < 8) return null;
  return { bank: m[1], accountNo, holder: m[3] };
}

/** `deviceBucket()`(lib/track.ts)이 주는 `ios-insta` 같은 값에서 플랫폼만 뽑는다 */
export function platformOf(bucket: string): "ios" | "aos" | "pc" {
  const plat = bucket.split("-")[0];
  return plat === "ios" || plat === "aos" ? plat : "pc";
}

/**
 * 토스 송금 화면을 여는 주소. PC에서는 열 수 없으므로 null을 준다.
 * 스킴: `supertoss://send?amount=..&bank=..&accountNo=..&origin=qr`
 */
export function tossSendUrl(
  account: BankAccount,
  amount: number,
  platform: "ios" | "aos" | "pc",
): string | null {
  if (platform === "pc") return null;
  const query = [
    `amount=${encodeURIComponent(String(amount))}`,
    `bank=${encodeURIComponent(account.bank)}`,
    `accountNo=${encodeURIComponent(account.accountNo)}`,
    "origin=qr",
  ].join("&");
  if (platform === "ios") return `supertoss://send?${query}`;
  return `intent://send?${query}#Intent;scheme=supertoss;package=${TOSS_ANDROID_PACKAGE};end`;
}
