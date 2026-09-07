/**
 * 결제 고객에게 보내는 후기 요청 메일 본문.
 *
 * 관리 화면(/admin/orders)에서 [후기 요청 메일]을 누르면 답례 쿠폰을 한 장 만들고
 * 이 글을 채워 보여준다 — TK님이 복사해서 support@kidstel.co.kr 로 직접 보낸다.
 * 자동 발송이 아니라 "만든 사람이 직접 쓴 편지" 톤이 목적이라, HTML이 아닌 평문이다.
 */
import { BUSINESS } from "@/lib/business";
import { koreanCallName } from "@/lib/prompts";

export interface ReviewMailInput {
  /** 아이 이름 (호칭 없이). 형제 책이면 "은율, 지아"처럼 쉼표로 */
  childName: string;
  /** 답례 쿠폰 */
  code: string;
  /** 쿠폰 만료 시각(ms). 없으면 "한 달" */
  expiresAt?: number;
}

/** 조사·호칭을 뗀 맨 이름 (지우의 → 지우, 하늘이와 → 하늘, 다솜이 → 다솜) */
function bareName(word: string): string {
  let name = word;
  if (name.length > 2) name = name.replace(/[의와과랑이가는은]$/, "");
  // 받침 있는 이름 뒤에 붙은 '이'는 호칭이지 이름이 아니다
  if (name.length > 2 && name.endsWith("이")) {
    const prev = name.charCodeAt(name.length - 2);
    if (prev >= 0xac00 && prev <= 0xd7a3 && (prev - 0xac00) % 28 !== 0) name = name.slice(0, -1);
  }
  return name;
}

/**
 * 책 제목에서 아이 이름을 짐작한다 — 제목이 "지우와 별빛 모험"처럼 이름으로 시작하는 게 보통이라서.
 * 형제 책("은율이와 지아의 반짝 숲")은 "은율, 지아". 첫 단어는 무조건 이름으로 보고,
 * 그다음 단어는 조사나 쉼표가 붙어 있을 때만 이름으로 본다("지우와 별빛 모험"의 별빛은 이름이 아니다).
 */
export function guessChildName(bookTitle: string): string {
  const names: string[] = [];
  for (const w of bookTitle.trim().split(/\s+/).slice(0, 3)) {
    const m = /^([가-힣]{2,5})(,?)$/.exec(w);
    if (!m) break;
    const raw = m[1];
    const hasParticle = raw.length > 2 && /[의와과랑이가는은]$/.test(raw);
    if (names.length > 0 && !hasParticle && !m[2]) break;
    names.push(bareName(raw));
    const connective = (raw.length > 2 && /[와과랑]$/.test(raw)) || m[2] === ",";
    if (!connective) break;
  }
  return names.join(", ");
}

/** "은율, 지아" → ["은율", "지아"] */
function splitNames(input: string): string[] {
  return input
    .split(/[,·\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 은율이와 지아 — 부르는 꼴(받침 있으면 '이')을 '와'로 잇는다. 호칭 꼴은 늘 모음으로 끝나 '와'가 맞다. */
function callNames(names: string[]): string {
  return names.map(koreanCallName).join("와 ");
}

function koreanDate(ms: number): string {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

export function reviewRequestMail(input: ReviewMailInput): { subject: string; body: string } {
  const names = splitNames(input.childName);
  // 부르는 꼴은 늘 모음으로 끝나므로(지훈→지훈이, 하나→하나) 뒤에 '는'·'의'·'가'를 그대로 붙여도 된다.
  const call = callNames(names); // 지훈 → 지훈이, 하나 → 하나, 은율·지아 → 은율이와 지아
  const parent = `${names.join("·")} 부모님`; // 은율·지아 부모님
  const until = input.expiresAt ? `${koreanDate(input.expiresAt)}까지` : "발급일로부터 한 달";
  const self = names.length > 1 ? "자신들의 모습" : "자신의 모습";

  const subject = `[${BUSINESS.service}] ${call} 부모님, 소중한 구매 감사드립니다.`;

  const lines = [
    `${parent}, 안녕하세요.`,
    ``,
    `${BUSINESS.service}를 만든 ${BUSINESS.owner}입니다. ${call}의 동화책을 주문해 주셔서 진심으로 감사드립니다.`,
    ``,
    `처음 제 아이들을 위해 만들기 시작한 책이 다른 아이에게 전달될 때마다 늘 큰 보람을 느낍니다. 혹시 ${call}가 책 속 ${self}을 보고 좋아했는지 정말 궁금합니다.`,
    ``,
    `시간이 되실 때 이 메일 답장으로 짧은 한두 줄의 후기나 책을 읽는 ${call} 사진을 전달해 주실 수 있으실까요?`,
    ``,
    `아울러 보내주신 후기의 홈페이지 활용 가능 여부도 함께 알려주시면 큰 도움이 됩니다.`,
    ``,
    `① 사진과 글 모두 가능 (아이 얼굴은 가려서 게시됩니다)`,
    `② 글만 가능`,
    `③ 게시 원치 않음`,
    ``,
    `감사의 마음을 담아 동화책 1권 무료 제작 쿠폰을 첨부해 드립니다. 후기 작성 여부와 상관없이 자유롭게 사용하셔도 됩니다.`,
    ``,
    `쿠폰 번호: ${input.code}`,
    `사용처: story.kidstel.co.kr (결제 시 쿠폰 코드 입력)`,
    `유효기간: ${until}`,
    ``,
    `${call}에게 이번 책이 기분 좋은 선물이 되었기를 바랍니다.`,
    ``,
    `감사합니다.`,
    `${BUSINESS.owner} 드림`,
    `${BUSINESS.name} · ${BUSINESS.service}`,
    BUSINESS.email,
  ];

  return { subject, body: lines.join("\n") };
}
