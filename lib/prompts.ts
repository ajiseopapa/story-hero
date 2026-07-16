// 사진 → 수채화 동화 삽화 변환의 "스타일 엔진".
// 어떤 사진을 넣어도 일관되게 예쁜 동화책 삽화가 나오도록 설계한 프롬프트 모음.

export type Gender = "girl" | "boy";

// 모든 삽화에 공통으로 씌우는 스타일 지문(고정).
// - 아이의 실제 얼굴/이목구비/머리/피부톤/표정을 반드시 유지
// - 첨부 예시(2번째 이미지)와 같은 부드러운 수채화 그림책 톤
// - 글자/워터마크 금지 (동화 텍스트는 앱에서 따로 얹음)
// 나이대별 체형/얼굴 성숙도 지시. gpt-image가 동화풍이라는 이유로
// 아이를 무조건 유아처럼 그리는 걸 막는 핵심 장치 (11세가 아기처럼 나오는 문제).
export function ageDescriptor(age: number, gender: Gender): string {
  const kid = gender === "girl" ? "girl" : "boy";
  if (age <= 6) {
    return `The main character is a ${age}-year-old ${kid} — sweet little-kid proportions with a soft round face are appropriate.`;
  }
  if (age <= 9) {
    return `The main character is a ${age}-year-old ${kid} in elementary school — draw school-age proportions (longer limbs, less baby fat), clearly older than a toddler.`;
  }
  return [
    `THE MOST IMPORTANT RULE — AGE: the main character is an ${age}-year-old preteen ${kid} (upper elementary school), and the drawing MUST look that age.`,
    "Realistic preteen proportions: the body is about five and a half to six head-heights tall, with a slender build, longer arms and legs, visible neck, and a more defined oval face — NOT a round baby face.",
    "Confident, capable posture like the hero of an illustrated middle-grade adventure novel for 10–12 year old readers.",
    "STRICTLY FORBIDDEN: toddler or chibi proportions (oversized head, stubby limbs, 2–3 head-heights tall), baby cheeks, baby-like cuteness. If in doubt, draw the character OLDER, never younger.",
  ].join(" ");
}

const STYLE_BASE = [
  "Transform the child from the reference photo into a soft, hand-painted watercolor children's picture-book illustration.",
  "Style: gentle classic storybook watercolor — soft washes, warm golden light, delicate ink linework, dreamy pastel palette, subtle paper texture, cozy and whimsical (in the spirit of timeless bedtime picture books).",
  "CRITICAL — likeness: keep the child's real face shape, eyes, nose, mouth, skin tone, hairstyle and gentle expression clearly recognizable and faithful to the photo. This is a portrait of THIS specific child, not a generic character.",
  "IMPORTANT — costume: do NOT copy the outfit from the photo. Instead, dress the child in the outfit and accessories described in the scene below, like a storybook character in costume. Only the face, hair and skin come from the photo; the clothing comes from the scene description.",
  "The child is the main character, captured MID-ACTION in a lively storybook moment — riding, flying, playing, discovering, hugging — together with the companion characters and creatures described in the scene. Never show the child just standing still alone in front of an empty background; the scene must feel alive and full of story.",
  "Absolutely NO text, NO words, NO letters, NO captions, NO watermark anywhere in the image.",
  "Full-bleed illustration, rich storybook background, wholesome and heart-warming.",
].join(" ");

// 표지용: 아이를 가장 사랑스럽게, 제목 공간을 위해 여백 살짝.
// 나이 지시를 스타일 지문보다 앞에 둔다 — 뒤에 두면 "그림책 스타일"이 이겨서 유아처럼 그림.
export function buildCoverPrompt(scene: string, age: number, gender: Gender): string {
  return [
    ageDescriptor(age, gender),
    STYLE_BASE,
    `Cover illustration. Scene: ${scene}.`,
    "Slightly more space around the child, magical inviting mood, like the front cover of a beloved picture book.",
  ].join(" ");
}

// 각 장면용.
export function buildScenePrompt(scene: string, age: number, gender: Gender): string {
  return [ageDescriptor(age, gender), STYLE_BASE, `Scene: ${scene}.`].join(" ");
}

// 이야기(글) 생성을 위한 시스템 프롬프트.
export function buildStorySystemPrompt(): string {
  return [
    "You are a warm, gentle Korean children's bedtime-story author and picture-book art director.",
    "You write soothing, cozy stories that a parent reads aloud to a young child before sleep.",
    "Return ONLY valid JSON, no markdown, no commentary.",
  ].join(" ");
}

// 이야기 주제 선택지 (UI와 공유)
export const THEMES = [
  { id: "space", label: "우주 여행", emoji: "🚀", ko: "우주 여행 — 별과 행성, 로켓, 반짝이는 밤하늘을 누비는 모험" },
  { id: "ocean", label: "해저 탐험", emoji: "🐠", ko: "해저 탐험 — 물고기 친구들, 산호초, 신비한 바닷속 세계" },
  { id: "animals", label: "동물 친구들", emoji: "🐰", ko: "동물 친구들 — 숲속·들판의 귀여운 동물들과 우정을 나누는 이야기" },
  { id: "dino", label: "공룡 시대", emoji: "🦕", ko: "공룡 시대 — 순하고 다정한 공룡들과 함께하는 아주 옛날 모험" },
  { id: "forest", label: "마법의 숲", emoji: "🧚", ko: "마법의 숲 — 요정, 반짝이는 꽃, 신비한 오두막이 있는 숲" },
  { id: "cloud", label: "구름 위 모험", emoji: "☁️", ko: "구름 위 모험 — 폭신한 구름, 달님과 별님을 만나는 하늘 여행" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function themeDescription(themeId: string): string | null {
  return THEMES.find((t) => t.id === themeId)?.ko ?? null;
}

// 한글 이름 호칭: 마지막 글자에 받침이 있으면 "이"를 붙임 (고은→고은이, 서아→서아)
// 이렇게 하면 조사가 항상 모음 뒤 형태(는/가/의)로 통일되어 자연스럽다.
export function koreanCallName(name: string): string {
  const code = name.charCodeAt(name.length - 1);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  if (isHangul && (code - 0xac00) % 28 !== 0) {
    return name + "이";
  }
  return name;
}

// 이야기 생성 유저 프롬프트. 이름/성별/주제를 반영, 표지+장면 텍스트와 각 장면의 영어 imagePrompt를 요청.
// 나이대별 이야기 톤/소재 가이드. 11세에게 "아기 파자마+아기 말투"가 나오는 걸 방지.
function ageStoryGuide(age: number): string {
  if (age <= 6) {
    return "아주 어린 아이 눈높이: 짧고 리듬감 있는 문장, 귀엽고 몽글몽글한 소재(폭신한 구름, 아기 동물)를 써도 좋아.";
  }
  if (age <= 9) {
    return "초등 저학년 눈높이: 유아 말투(\"~해요 아가야\" 같은 톤)는 피하고, 호기심과 작은 용기가 담긴 모험을 넣어줘.";
  }
  return [
    `주인공은 ${age}세 초등 고학년이야. 절대 아기 취급하지 마.`,
    "유아용 말투·소재(아기 별님, 쪽쪽이, 아장아장 등)는 금지. 대신 또래다운 지혜, 우정, 스스로 문제를 해결하는 멋진 순간을 담아줘.",
    "따뜻한 취침 동화 분위기는 유지하되, 주인공이 의젓하고 듬직하게 활약하게 해줘.",
    "imagePrompt의 의상도 유아 파자마가 아니라 이 나이대에 어울리는 멋진 모험 복장(탐험가 재킷, 별지기 망토 등)으로 정해줘.",
  ].join(" ");
}

export function buildStoryUserPrompt(
  name: string,
  gender: Gender,
  age: number,
  sceneCount: number,
  themeKo: string,
): string {
  const genderKo = gender === "girl" ? "여자아이" : "남자아이";
  const pronoun = gender === "girl" ? "she/her" : "he/him";
  const callName = koreanCallName(name);
  return `아이 이름: "${name}" (${age}세 ${genderKo}, ${pronoun})
연령 가이드: ${ageStoryGuide(age)}
이야기 속 호칭: "${callName}" (예: "${callName}는", "${callName}가", "${callName}의")
이야기 주제: ${themeKo}

이 아이를 주인공으로, 위 주제의 세계에서 펼쳐지는 아주 따뜻하고 포근한 '취침 동화'를 만들어줘.
- 이야기의 배경, 등장 친구들, 기본 의상, 소품 모두 이 주제에 맞춰줘.
- 잠자기 전에 부모가 아이에게 읽어주는 느낌. 부드럽고, 안심되고, 사랑이 느껴지게.
- 주인공은 반드시 위의 호칭 "${callName}"(으)로만 불러줘 ("${callName}는", "${callName}가"처럼 조사를 자연스럽게 붙여서). 별명이나 다른 이름을 절대 지어내지 마.
- "그녀", "그" 같은 대명사는 쓰지 말고 항상 호칭으로 불러줘. 아이에게 읽어주는 말투로.
- 제목은 반드시 "${callName}의 "로 시작해 (예: "${callName}의 별빛 여행"). 이름 뒤에 "의" 없이 단어를 바로 붙이면 안 돼 — "${callName}별길"처럼 붙이면 다른 단어("이별")로 오해될 수 있어.
- 총 ${sceneCount}개의 장면으로 이야기가 자연스럽게 이어져야 해. (시작 → 작은 모험/발견 → 따뜻한 마무리와 잠자리)
- **줄거리 일관성 (중요)**: 이야기 전체를 관통하는 **하나의 목표나 사건**을 정하고, 모든 장면이 그 하나의 이야기 줄기 위에 있어야 해. 각 장면은 반드시 **바로 앞 장면의 결과로 자연스럽게 이어져야** 하고, 앞에서 벌어진 일과 모순되면 안 돼. 장면마다 새로운 등장인물·새로운 장소를 남발하지 말고(친구는 단짝 하나면 충분), 중간에 갑자기 다른 사건으로 튀지 마. 먼저 머릿속으로 전체 줄거리를 한 문장으로 정한 뒤에 장면을 나눠 써.
- 각 장면 텍스트는 한국어로 2~4문장, 아이 이름 "${name}"을(를) 주인공으로 자연스럽게 등장시켜줘.
- 마지막 장면은 아이가 포근하게 잠드는 평화로운 결말로.

또한 삽화를 위해, 각 장면과 표지에 대한 "장면 묘사(imagePrompt)"를 **영어로** 써줘.
- 먼저 이 동화의 주제와 **주인공 나이(${age}세)**에 어울리는 주인공의 **기본 의상(base outfit)** 하나를 정해. 모든 imagePrompt에 이 기본 의상 묘사를 똑같이 반복해서 넣어 — 그래야 책 전체에서 주인공 옷이 일관돼.
- 모든 imagePrompt에 주인공 나이를 명시해 (예: "an ${age}-year-old ${gender === "girl" ? "girl" : "boy"}, ..."). 의상·행동·자세 모두 그 나이에 자연스럽게.
- 주제에 어울리는 **단짝 친구 캐릭터(companion)** 하나도 정해 (예: 우주면 "a small friendly golden star creature with a smiling face", 동물이면 "a fluffy white bunny with a tiny red scarf"). 이 친구는 이야기 글에도 등장시키고, **모든 imagePrompt에 똑같은 묘사로 반복**해서 넣어 — 책 전체에서 같은 친구로 그려지게.
- 각 imagePrompt에는 아이가 **무엇을 하고 있는지(행동)**를 반드시 구체적으로 담아 — 구름을 타고 날아가는 중, 고래 등에 올라탄 모습, 토끼와 함께 딸기를 따는 중, 별똥별을 쫓아 달리는 중처럼. **배경 앞에 가만히 서 있는 장면은 금지.**
- 장면마다 이야기에 맞는 **소품/액세서리**를 더해줘 (예: 작은 등불, 나침반 목걸이, 꽃바구니, 마법 지팡이). 소품은 장면 전개에 따라 자연스럽게 바뀌어도 좋아.
- 그 다음 배경/분위기/시간대를 묘사 (예: "wearing [base outfit], together with [companion], riding a fluffy pink cloud through a sunset sky, holding a tiny glowing lantern, castle towers peeking through clouds below").
- imagePrompt에 아이의 얼굴/머리/피부 같은 외모 묘사는 적지 마 (그건 사진에서 가져올 거야). 글자나 단어를 그려달라는 표현도 금지.
- 각 장면 묘사는 서로 다른 배경/상황으로 다채롭게, 하지만 하나의 이야기로 이어지게.

다음 JSON 형식으로만 답해:
{
  "title": "동화 제목 (한국어, 아이 이름 포함, 8자 내외)",
  "cover": { "imagePrompt": "표지용 영어 장면 묘사" },
  "scenes": [
    { "text": "1장면 한국어 텍스트", "imagePrompt": "1장면 영어 장면 묘사" }
    // ... 총 ${sceneCount}개
  ]
}`;
}
