/**
 * OpenAI 오류를 원인별로 가른다.
 *
 * 2026-09-01, 인스타 홍보 중에 화면에 "429 you have no credits remaining"이 그대로 떴다.
 * 손님에게는 뜻도 통하지 않고(영어), 우리는 서버 로그를 안 보면 며칠이 지나도 모른다.
 * 여기서 원인을 갈라 손님에겐 한국어 안내를, 우리에겐 메일 알림을 보낸다.
 */
import OpenAI from "openai";

export type Failure = "credits" | "auth" | "rate" | "other";

export function classifyOpenAIError(err: unknown): Failure {
  const api = err instanceof OpenAI.APIError ? err : null;
  const code = String(api?.code ?? "");
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();

  if (code === "insufficient_quota" || /no credits|insufficient.quota|exceeded your current quota|billing/.test(msg)) {
    return "credits";
  }
  if (api?.status === 401 || api?.status === 403 || code === "invalid_api_key" || /api key/.test(msg)) {
    return "auth";
  }
  if (api?.status === 429) return "rate";
  return "other";
}

/** 손님에게 보일 문구. 영어 원문과 우리 사정(크레딧·키)은 그대로 노출하지 않는다. */
export function userMessage(kind: Failure, fallback: string): string {
  switch (kind) {
    case "credits":
    case "auth":
      // 손님 잘못이 아니고 기다린다고 풀리지도 않는다 — 사과하고 알려달라고 한다
      return "지금은 동화를 만들 수 없어요. 잠시 뒤에 다시 시도해주세요. 계속 안 되면 support@kidstel.co.kr로 알려주시면 바로 고칠게요 🙏";
    case "rate":
      return "지금 동화를 만드는 분이 많아요. 1~2분 뒤에 다시 시도해주세요.";
    default:
      return fallback;
  }
}

/** 관리자 메일 제목·본문 (알림을 보낼 원인일 때만) */
export function adminAlert(kind: Failure, where: string): { subject: string; body: string } | null {
  if (kind === "credits") {
    return {
      subject: "OpenAI 크레딧이 떨어져 동화 생성이 멈췄어요",
      body: `${where} 요청이 크레딧 부족으로 실패했습니다.\n\n지금 사이트에 들어온 사람은 샘플을 만들 수 없습니다.\nplatform.openai.com 결제 화면에서 잔액과 자동충전 월 한도를 확인해주세요.\n(자동충전이 켜져 있어도 그 달의 한도를 다 쓰면 더 충전되지 않습니다.)`,
    };
  }
  if (kind === "auth") {
    return {
      subject: "OpenAI API 키가 거부됐어요 — 동화 생성이 멈췄습니다",
      body: `${where} 요청이 인증 오류로 실패했습니다.\n\nOPENAI_API_KEY가 만료·삭제됐거나 권한이 바뀌었을 수 있습니다.\nVercel 환경변수와 OpenAI 대시보드의 키를 확인해주세요.`,
    };
  }
  return null;
}
