/**
 * 결제 고객에게 보내는 후기 요청 메일 본문.
 *
 * 관리 화면(/admin/orders)에서 [후기 요청 메일]을 누르면 답례 쿠폰을 한 장 만들고
 * 이 글을 채워 보여준다 — TK님이 복사해서 support@kidstel.co.kr 로 직접 보낸다.
 * 자동 발송이 아니라 "만든 사람이 직접 쓴 편지" 톤이 목적이라, HTML이 아닌 평문이다.
 */
import { BUSINESS } from "@/lib/business";
import { koreanCallName } from "@/lib/prompts";

export type Honorific = "어머님" | "아버님";

export interface ReviewMailInput {
  /** 아이 이름 (호칭 없이). 형제 책이면 "은율, 지아"처럼 쉼표로 */
  childName: string;
  honorific: Honorific;
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
  const parent = `${names.join("·")} ${input.honorific}`; // 은율·지아 어머님
  const until = input.expiresAt ? `${koreanDate(input.expiresAt)}까지` : "한 달";

  const subject = `${call} 동화책, 잘 보고 계신가요?`;

  const lines = [
    `${parent}께,`,
    ``,
    `안녕하세요. 키즈북을 만든 김태경입니다.`,
    `${call} 동화책을 주문해 주셔서 고맙습니다.`,
    ``,
    `결제 알림이 온 날, 휴대폰을 한참 들여다봤습니다.`,
    names.length > 1
      ? `낯선 아이들 이름이 그렇게 반가울 수 있다는 걸 그날 알았습니다.`
      : `낯선 아이 이름 하나가 그렇게 반가울 수 있다는 걸 그날 알았습니다.`,
    ``,
    `저도 부산에서 아이 셋을 키우는 아빠입니다.`,
    `처음엔 우리 집 아이들에게 보여주려고 만든 책이었습니다.`,
    `그래서 지금 제일 궁금한 건 하나입니다.`,
    `${call}는 책 속 자기 얼굴을 보고 어떤 표정이었을까.`,
    ``,
    `그걸 여쭤보려고 편지를 씁니다.`,
    `이 메일에 답장으로 한두 줄만 적어 주시면 됩니다. 길지 않아도 괜찮습니다.`,
    `책을 보던 ${call} 사진이나 화면 캡처가 한 장 있다면, 더할 나위 없겠습니다.`,
    ``,
    `한 가지만 더 여쭙니다.`,
    `보내주신 글과 사진을 키즈북 홈페이지 후기에 올려도 될까요?`,
    `번호 하나만 적어 주세요.`,
    `① 사진과 글 모두 괜찮아요 (아이 얼굴은 가려서 올립니다)`,
    `② 글만 올려 주세요`,
    `③ 올리지 말아 주세요`,
    ``,
    `어떤 답이든, 다음에 이 책을 고민하는 어느 부모님께 큰 힘이 됩니다.`,
    ``,
    `작은 답례로, 책 한 권을 더 만들 수 있는 쿠폰을 넣어 드립니다.`,
    `${call}의 다른 이야기여도 좋고, 형제나 사촌 아이의 책이어도 좋습니다.`,
    `후기를 못 주시더라도 쿠폰은 편하게 쓰셔도 됩니다.`,
    ``,
    `쿠폰: ${input.code}`,
    `쓰는 곳: story.kidstel.co.kr 에서 책을 만들고 결제하실 때 입력`,
    `기한: ${until}`,
    ``,
    `읽어주셔서 고맙습니다.`,
    `${call}가 책 속 자기 얼굴을 오래오래 좋아해 주면 좋겠습니다.`,
    ``,
    `${BUSINESS.owner} 드림`,
    `${BUSINESS.name} · ${BUSINESS.service}`,
    BUSINESS.email,
    BUSINESS.tel,
  ];

  return { subject, body: lines.join("\n") };
}
