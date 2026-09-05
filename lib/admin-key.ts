/**
 * 관리자 키 기억하기.
 *
 * 북마크에 ?key=가 빠진 채 저장되면 매번 키를 새로 넣어야 했다 (2026-08-13).
 * URL로 한 번이라도 들어오면 이 브라우저에 기억해두고, 다음부터는 주소에
 * 키가 없어도 그대로 열리게 한다. 관리자 화면 넷이 같은 키를 쓴다.
 */
const STORE = "kb_admin_key";

/** URL ?key= 우선, 없으면 기억해둔 키. URL로 온 키는 기억해둔다. */
export function recallAdminKey(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("key");
  if (fromUrl) {
    try {
      localStorage.setItem(STORE, fromUrl);
    } catch {
      /* 시크릿 모드 등에서 저장 실패해도 이번 방문은 동작해야 한다 */
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(STORE) ?? "";
  } catch {
    return "";
  }
}

/** 직접 입력한 키가 맞았을 때 기억해둔다 */
export function rememberAdminKey(key: string): void {
  try {
    localStorage.setItem(STORE, key);
  } catch {
    /* 저장 못 해도 치명적이지 않다 */
  }
}

/** 서버가 거부한 키는 잊는다 — 코드를 바꾼 뒤 옛 키가 남아 있으면 입력란이 다시 떠야 한다 */
export function forgetAdminKey(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* 무시 */
  }
}
