// 사진 → 수채화 동화 삽화 변환의 "스타일 엔진".
// 어떤 사진을 넣어도 일관되게 예쁜 동화책 삽화가 나오도록 설계한 프롬프트 모음.

export type Gender = "girl" | "boy";

// 삽화에 그려질 아이 스펙 (형제·자매 함께 주인공 지원: 1~3명)
export type ChildSpec = { age: number; gender: Gender };
// 이야기 생성용 아이 스펙 (이름 포함)
export type StoryChild = { name: string; age: number; gender: Gender };

export const MAX_CHILDREN = 3;

const ORDINALS = ["FIRST", "SECOND", "THIRD"];

// 모든 삽화에 공통으로 씌우는 스타일 지문(고정).
// - 아이의 실제 얼굴/이목구비/머리/피부톤/표정을 반드시 유지
// - 첨부 예시(2번째 이미지)와 같은 부드러운 수채화 그림책 톤
// - 글자/워터마크 금지 (동화 텍스트는 앱에서 따로 얹음)
// 나이대별 체형/얼굴 성숙도 지시. gpt-image가 동화풍이라는 이유로
// 아이를 무조건 유아처럼 그리는 걸 막는 핵심 장치 (11세가 아기처럼 나오는 문제).
// subject를 바꿔 다인 주인공에서 "Main character 2 (…)"처럼 재사용한다.
// ⚠️2026-08-22: 예전엔 10세+ 구간만 강한 지시(최우선 규칙 + 금지문)를 달아놔서
// 그 구간만 말을 듣고 0~9세는 전부 "귀여운 유아"로 수렴했다 (1·4·8세 샘플이 같은 얼굴로 나옴).
// 이제 네 구간 모두 같은 강도로 — 나이별 실제 특징을 나열하고, 아닌 쪽을 금지문으로 막는다.
export function ageDescriptor(
  age: number,
  gender: Gender,
  subject = "The main character",
): string {
  const kid = gender === "girl" ? "girl" : "boy";
  const who = age === 0 ? "baby under 1 year old" : `${age}-year-old`;
  const head = `AGE IS A TOP-PRIORITY RULE — ${subject} is a ${who} ${kid}, and the drawing MUST look exactly that age.`;
  // 참고 사진은 다른 나이에 찍힌 것일 수 있다 (샘플 갤러리는 사진 한 장으로 네 나이를 그린다).
  // 신원은 사진에서, 나이는 이 규칙에서 — 이 분리를 못 박지 않으면 모델이 사진 속 나이를 그대로 베낀다.
  const source = `The reference photo may have been taken at a different age. IDENTITY comes from the photo (eye shape and spacing, hairline, hairstyle, nose bridge, moles, dimples, gaps between teeth, skin tone); AGE comes from this rule (body proportions, facial maturity, baby fat, teeth, neck length). Draw the SAME child as they look at ${age === 0 ? "under one year old" : `age ${age}`} — do NOT simply copy the age you see in the photo.`;

  if (age <= 2) {
    return [
      head,
      source,
      "Real infant anatomy: the whole body is about four head-heights tall. A big rounded forehead with the hairline set far back; hair thin, fine and sparse — never a full styled head of hair. The eyes sit BELOW the vertical middle of the head. Small short nose with a low flat bridge. Very full round cheeks, a small receding chin, and almost no visible neck — the head sits straight on the shoulders. Short chubby arms and legs with soft creases at the wrists, elbows and knees, and tiny dimpled hands. If the mouth is open, show only two to four tiny front teeth — never a full row.",
      "STRICTLY FORBIDDEN: drawing a preschooler instead of a baby — no thick styled hair, no full set of teeth, no defined jawline, no long slim limbs, no long neck. If in doubt, draw the character YOUNGER, never older.",
      "Keep the baby safely nestled, seated with legs splayed, or gently held in the scene (never in a dangerous pose).",
    ].join(" ");
  }
  if (age <= 6) {
    return [
      head,
      source,
      "Real preschooler anatomy: the whole body is about five head-heights tall. This age still carries a lot of baby fat and must look SOFT and PLUMP, never lean. Full rounded cheeks are the widest part of the face, with a soft rounded chin and NO visible jawline or cheekbones; a small nose, a full set of small baby teeth, and a short but clearly visible neck. The body is softly padded: a rounded little tummy, chubby arms and legs with soft creases at the wrists, elbows and knees, dimpled hands, and plump feet. The head is NOT oversized — it is no wider than the shoulders.",
      "STRICTLY FORBIDDEN: infant proportions (four head-heights, no neck, sparse hair) and any school-age slimness — no hollow, flat or sunken cheeks, no defined jawline or cheekbones, no thin wiry arms and legs, no lean athletic build. A preschooler drawn slim looks gaunt and wrong; when in doubt, draw them SOFTER and ROUNDER (but never with a bigger head).",
    ].join(" ");
  }
  if (age <= 9) {
    return [
      head,
      source,
      "Real school-age anatomy: the whole body is about five and a half to six head-heights tall, with clearly longer arms and legs, a slimmer torso and a visible neck. FACE — still a young child, only halfway to a teenager: the face is still comparatively WIDE and short, the cheeks have thinned but are not hollow and the cheekbones do not show, the chin is small and rounded, the nose is still short with a low soft bridge, and the eyes are still LARGE relative to the face. The permanent front teeth have come in and look slightly too big for this small face. This must read instantly as a lower-elementary child — clearly older than a preschooler, and just as clearly YOUNGER than a preteen.",
      "STRICTLY FORBIDDEN: toddler or preschooler features — round baby face, plump baby cheeks, stubby limbs, oversized head, baby teeth. If in doubt, draw the character OLDER, never younger.",
    ].join(" ");
  }
  return [
    `THE MOST IMPORTANT RULE — AGE: ${subject} is an ${age}-year-old preteen ${kid} (upper elementary school), and the drawing MUST look that age.`,
    source,
    "Realistic preteen proportions: the body is about six to six and a half head-heights tall, with a slender build, longer arms and legs, and a long slim neck. FACE — this is where the age must show, so make it clearly different from a 7-year-old: the LOWER half of the face has grown, so the face is distinctly LONG and oval rather than wide; the cheeks are flat with visible cheekbones and a defined jawline and a stronger, slightly squarer chin; the nose is longer with a raised bridge; and because the face has grown around them, the eyes now look SMALLER in proportion to the face. A 7-year-old and a 10-year-old must never look interchangeable.",
    "Confident, capable posture like the hero of an illustrated middle-grade adventure novel for 10–12 year old readers.",
    "STRICTLY FORBIDDEN: toddler or chibi proportions (oversized head, stubby limbs, 2–3 head-heights tall), baby cheeks, baby-like cuteness. If in doubt, draw the character OLDER, never younger.",
  ].join(" ");
}

// 주인공 전원(1~3명)의 나이/성별 지시 블록.
// 다인일 때는 "N번째 참고 사진의 아이 = N번째 캐릭터" 매핑을 명시한다.
function castDescriptor(children: ChildSpec[]): string {
  if (children.length === 1) {
    return ageDescriptor(children[0].age, children[0].gender);
  }
  const parts = children.map((c, i) =>
    ageDescriptor(
      c.age,
      c.gender,
      `Main character ${i + 1} (the child from the ${ORDINALS[i]} reference photo)`,
    ),
  );
  return [
    `This illustration has ${children.length} main characters — real siblings who appear TOGETHER in every scene, one child from each reference photo, in the same order.`,
    ...parts,
  ].join(" ");
}

// 고를 수 있는 그림체.
// 3D 카툰은 실제 비교 테스트에서 얼굴이 "예쁜 캐릭터"로 일반화돼 제외했다 (2026-08-12).
// 닮음이 이 서비스의 유일한 해자라 그림체는 닮음을 지키는 것만 남긴다.
export type ArtStyleId = "realistic" | "watercolor" | "pencil" | "crayon";

export const ART_STYLES: {
  id: ArtStyleId;
  label: string;
  sub: string;
  emoji: string;
  /** 초상 프레임에 넣을 재료 이름 */
  medium: string;
  /** 그림체 지문 */
  style: string;
}[] = [
  {
    id: "realistic",
    label: "사실적 그림",
    sub: "가장 닮게",
    emoji: "🖼️",
    medium: "realistic painted",
    style:
      "Style: richly detailed realistic painterly illustration — true-to-life facial rendering and natural body proportions, oil and gouache brushwork with fine detail, warm cinematic light, in the spirit of classic realistic children's book paintings. Keep it painterly and warm, never photographic or uncanny.",
  },
  {
    id: "watercolor",
    label: "수채화",
    sub: "포근한 그림책",
    emoji: "🎨",
    medium: "watercolor",
    style:
      "Style: gentle classic storybook watercolor — soft washes, warm golden light, delicate ink linework, dreamy pastel palette, subtle paper texture, cozy and whimsical (in the spirit of timeless bedtime picture books).",
  },
  {
    id: "pencil",
    label: "색연필",
    sub: "부드럽고 따뜻하게",
    emoji: "✏️",
    medium: "coloured-pencil",
    style:
      "Style: gentle coloured-pencil illustration — fine hatching and soft blended pencil strokes, light grain of the paper showing through, muted natural palette, delicate and warm like a hand-drawn picture book.",
  },
  {
    id: "crayon",
    label: "크레파스",
    sub: "아이 그림책 질감",
    emoji: "🖍️",
    medium: "crayon and oil-pastel",
    style:
      "Style: warm children's crayon and oil-pastel illustration — chunky waxy strokes, visible paper tooth, bold saturated colours layered by hand, slightly rough outlines, the charm of a picture book drawn with crayons.",
  },
];

/** 새로 만드는 책의 기본 그림체 */
export const DEFAULT_ART: ArtStyleId = "realistic";

/** 예전 초안엔 그림체 값이 없다 — 그때는 수채화로 만들었으므로 그걸로 되돌린다. */
export function artStyle(id?: string) {
  return ART_STYLES.find((a) => a.id === id) ?? ART_STYLES[1];
}

// "그림책 캐릭터로 변환"이라고 하면 만화 얼굴로 뭉개짐 —
// "실제 아이를 그린 초상"이라는 프레임이 닮음을 훨씬 잘 지킴.
// 다인(형제·자매)일 때는 얼굴을 서로 섞거나 바꾸는 사고를 막는 지시가 핵심.
function styleBase(count: number, artId?: string): string {
  const single = count === 1;
  const art = artStyle(artId);
  const m = art.medium;
  return [
    single
      ? `A skilled portrait artist depicts THIS real child (from the reference photo) in ${m} illustration, placing them inside a storybook scene. The face is a faithful ${m} PORTRAIT OF THE PHOTOGRAPH — the same face at the same proportions, only rendered in this medium.`
      : `A skilled portrait artist depicts THESE ${count} real children (one from each reference photo, in the same order) in ${m} illustration, placing them TOGETHER inside one storybook scene. Each child's face is a faithful ${m} PORTRAIT of that child's OWN photograph — the same face at the same proportions, only rendered in this medium.`,
    single
      ? "TOP PRIORITY — PORTRAIT LIKENESS: anyone who knows the child must recognize them instantly. Keep the photograph's facial proportions exactly: the real eye shape and eye size relative to the face (do NOT enlarge the eyes, do NOT make the face rounder or more 'cute' than the photo — the medium must never soften the face into a generic cartoon child. The ONLY thing allowed to change how old the child looks is the AGE rule stated above; the drawing style itself never makes them younger or older), eyebrows, nose, mouth and teeth, chin and cheek structure, skin tone, and the exact hairstyle (parting, bangs, length, color). Preserve distinctive personal features exactly — moles, freckles, dimples, gaps between teeth, glasses. Stylize only the MEDIUM (the drawing technique, palette, linework) — never the facial identity. When the storybook style and the likeness conflict, likeness always wins."
      : "TOP PRIORITY — PORTRAIT LIKENESS OF EVERY CHILD: anyone who knows these children must recognize EACH one instantly. For EACH child, keep that child's own photograph's facial proportions exactly: the real eye shape and eye size relative to the face (do NOT enlarge the eyes, do NOT make the face rounder or more 'cute' than the photo — the medium must never soften the face into a generic cartoon child. The ONLY thing allowed to change how old the child looks is the AGE rule stated above; the drawing style itself never makes them younger or older), eyebrows, nose, mouth and teeth, chin and cheek structure, skin tone, and the exact hairstyle (parting, bangs, length, color). Preserve each child's distinctive personal features exactly — moles, freckles, dimples, gaps between teeth, glasses. NEVER blend, average, or swap facial features, hairstyles or skin tones BETWEEN the children — each child keeps their OWN face from their OWN photo only. Stylize only the MEDIUM (the drawing technique, palette, linework) — never the facial identity. When the storybook style and the likeness conflict, likeness always wins.",
    // 닮음 지시가 강할수록 모델이 얼굴을 "보여주려고" 머리를 부풀린다 —
    // 닮음과 머리 크기는 별개라는 걸 못 박아야 3.5등신 대두가 안 나온다 (2026-08-13).
    "HEAD SIZE — read this together with the likeness rule: keeping the likeness means drawing the face ACCURATELY, never drawing it BIGGER. The head must stay in natural anatomical proportion to the body for a real child of this age — no wider than the shoulders, sitting on a visible neck, with the body at the head-height count given above. Big-head, chibi, bobblehead or caricature proportions are FORBIDDEN even in a soft storybook style. If the face ends up small in the frame, render it with finer detail — do NOT enlarge the head to make it readable.",
    art.style,
    single
      ? "IMPORTANT — costume: do NOT copy the outfit from the photo. Instead, dress the child in the outfit and accessories described in the scene below, like a storybook character in costume. Only the face, hair and skin come from the photo; the clothing comes from the scene description."
      : "IMPORTANT — costume: do NOT copy the outfits from the photos. Instead, dress each child in the outfit and accessories described for them in the scene below, like storybook characters in costume. Only each child's face, hair and skin come from their photo; the clothing comes from the scene description.",
    single
      ? "The child is the main character, captured MID-ACTION in a lively storybook moment — riding, flying, playing, discovering, hugging — together with the companion characters and creatures described in the scene. Never show the child just standing still alone in front of an empty background; the scene must feel alive and full of story."
      : "The children are the main characters, captured MID-ACTION together in one lively storybook moment — riding, flying, playing, discovering, hugging, helping each other — with the companion characters and creatures described in the scene. They interact like loving siblings sharing one adventure. Never show them just standing still in front of an empty background; the scene must feel alive and full of story.",
    "Absolutely NO text, NO words, NO letters, NO captions, NO watermark anywhere in the image.",
    "Full-bleed illustration, rich storybook background, wholesome and heart-warming.",
  ].join(" ");
}

// 표지용: 아이를 가장 사랑스럽게, 제목 공간을 위해 여백 살짝.
// 나이 지시를 스타일 지문보다 앞에 둔다 — 뒤에 두면 "그림책 스타일"이 이겨서 유아처럼 그림.
export function buildCoverPrompt(scene: string, children: ChildSpec[], artId?: string): string {
  return [
    castDescriptor(children),
    styleBase(children.length, artId),
    `Cover illustration. Scene: ${scene}.`,
    children.length === 1
      ? "Slightly more space around the child, magical inviting mood, like the front cover of a beloved picture book."
      : "Slightly more space around the children, magical inviting mood, like the front cover of a beloved picture book.",
  ].join(" ");
}

// 각 장면용.
export function buildScenePrompt(scene: string, children: ChildSpec[], artId?: string): string {
  return [castDescriptor(children), styleBase(children.length, artId), `Scene: ${scene}.`].join(
    " ",
  );
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
  { id: "treasure", label: "보물섬 탐험", emoji: "🗺️", ko: "보물섬 탐험 — 낡은 지도, 수수께끼, 반짝이는 보물을 찾아 떠나는 섬 모험" },
  { id: "winter", label: "눈의 나라", emoji: "⛄", ko: "눈의 나라 — 눈사람 친구, 오로라, 반짝이는 얼음 궁전이 있는 겨울 왕국" },
  { id: "candy", label: "과자 나라", emoji: "🍭", ko: "과자 나라 — 사탕 꽃, 초콜릿 강, 폭신한 마시멜로 언덕의 달콤한 세계" },
  { id: "castle", label: "왕국과 성", emoji: "🏰", ko: "왕국과 성 — 오래된 성, 다정한 용, 용감한 기사와 공주가 있는 왕국 이야기" },
  { id: "train", label: "마법 기차", emoji: "🚂", ko: "마법 기차 — 밤하늘을 달리는 신비한 기차를 타고 정거장마다 새로운 세계를 만나는 여행" },
  { id: "jungle", label: "정글 탐험", emoji: "🦁", ko: "정글 탐험 — 우거진 밀림, 신비한 폭포, 씩씩한 동물 친구들과 함께하는 탐험" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

// 아무것도 고르지 않은 사람에게도 버튼이 눌리게 하는 기본값.
// 주제 12개 + 그림체 4개를 다 고르게 하느라 무료 샘플 버튼이 화면 네 개 아래에 있었다 (2026-08-26).
export const DEFAULT_THEME: ThemeId = "space";

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
// 나이대별 이야기 가이드.
// ⚠️예전엔 "톤" 한 줄뿐이라 4세와 10세 이야기의 줄거리 뼈대·문장 길이가 똑같이 나왔다 (2026-08-13).
// 톤만 말하면 모델이 구성까지 바꾸지는 않는다 — 문장 수·사건 구조·대사·금지사항을 각각 지정한다.
function ageStoryGuide(age: number): string {
  if (age <= 2) {
    return [
      "【아기(0~2세) 구성】",
      "· 사건 구조: 사건이랄 게 없어야 해. 잠자리로 가는 아주 단순한 하나의 흐름(포근한 것을 하나씩 만나고 → 안겨서 → 잠든다)만 있으면 돼. 문제·위기·해결 금지.",
      "· 문장: 한 문장을 아주 짧게(대략 15자 이내). 자장가처럼 부르듯이.",
      "· 리듬: 의성어·의태어(토닥토닥, 폭신폭신, 새근새근)를 매 장면에 넣고, 장면마다 같은 후렴 한 구절을 반복해줘 (예: \"○○는 폭신폭신 좋아요\"). 반복이 이 나이대의 재미다.",
      "· 어휘: 아기가 아는 말만 (엄마, 달님, 폭신, 따뜻, 안아). 비유·수식어 겹치기 금지.",
      "· 주인공은 안기거나 태워지는 등 보호받는 모습으로.",
    ].join("\n");
  }
  if (age <= 6) {
    return [
      "【유아(3~6세) 구성】",
      "· 사건 구조: 아주 작은 문제 하나(친구가 무언가를 잃어버림, 불이 꺼짐)를 만나서 곧바로 도와주고 해결하는 단순한 흐름. 반전·복잡한 사연 금지.",
      "· 문장: 짧고 리듬감 있게(대략 25자 이내). 한 문장에 정보를 하나만 담되, 장면당 3~4문장으로 이야기를 충분히 풀어줘.",
      "· 리듬: 의성어·의태어를 살리고, 이야기 내내 반복되는 짧은 말버릇이나 후렴을 하나 만들어줘.",
      "· 어휘: 유치원생이 아는 말로. 비유를 쓸 거면 아이가 아는 것에만 빗대(솜사탕, 이불, 아기 고양이).",
      "· 귀엽고 몽글몽글한 소재(폭신한 구름, 아기 동물) 환영.",
    ].join("\n");
  }
  if (age <= 9) {
    return [
      "【초등 저학년(7~9세) 구성】",
      "· 사건 구조: 목표 → 시도 → 잘 안 됨 → 다시 궁리해서 해결. '한 번 막히는' 대목이 반드시 있어야 재미있다.",
      "· 문장: 짧은 문장과 조금 긴 문장을 섞어(대략 40자 이내). 장면당 4~5문장.",
      "· 대사: 주인공이 스스로 판단하고 제안하는 말을 넣어 (\"이렇게 해보면 어때?\").",
      "· 유아 말투(\"~해요 아가야\", 아장아장)는 금지. 대신 호기심과 작은 용기.",
      "· 아이가 아는 것(학교, 친구, 규칙, 약속)을 한 군데 슬쩍 걸어주면 몰입이 커진다.",
    ].join("\n");
  }
  return [
    `【초등 고학년(${age}세) 구성】`,
    "· 주인공을 절대 아기 취급하지 마. 유아용 말투·소재(아기 별님, 쪽쪽이, 아장아장) 금지.",
    "· 사건 구조: 분명한 목표 → 시도 → 실패 한 번(진짜로 잘못되는 대목) → 스스로 방법을 바꿔 해결. 어른이나 요정이 대신 해결해주면 안 돼.",
    "· 문장: 복문을 써도 좋고 장면당 5~6문장. 설명하지 말고 장면으로 보여줘.",
    "· 대사: 또래다운 담백한 말투로. 감탄사 남발(\"우와\" 연발) 금지.",
    "· 호칭: 이름을 매 문장 반복하지 마 — 한 장면에 한 번이면 충분하고, 나머지는 문장 구조로 자연스럽게 넘겨.",
    "· 감정: 뿌듯함·아쉬움·책임감처럼 한 겹 깊은 감정을 담아. 교훈을 설명하지 말고 행동으로 드러나게.",
    "· imagePrompt의 의상도 유아 파자마가 아니라 이 나이대에 어울리는 멋진 모험 복장(탐험가 재킷, 별지기 망토 등)으로 정해줘.",
  ].join("\n");
}

// 장면 하나에 들어갈 글 분량. 나이대별로 다르다 —
// 전 연령 "2~4문장"으로 고정했더니 4세 책도 부모가 읽기 벅찬 길이가 나왔고,
// 반대로 "2~3문장"은 모델이 하한(1~2문장)에 붙어 유료 책이 휑해 보였다 (2026-08-13, 6세 실측).
// 그래서 범위 하한을 올리고 "최소 N문장"을 명시한다 — 모델은 범위를 주면 하한을 고른다.
//
// ⭐2026-09-01 실측(1·4·7·10세 한 권씩 생성): 문장 "개수"는 지시를 지키는데 문장 "길이"는
// 상한의 절반쯤에서 쓴다 — 4세는 25자 상한에 17자(책 534자), 7세는 40자 상한에 23자(1,008자).
// 상한만 주면 모델은 짧은 쪽에 붙으므로, 중간 두 구간은 **글자수 범위(하한 포함)**로 바꾸고
// 장면 하나의 총 분량까지 못박는다. 10세 구간(3,160자)은 지금 분량이 적당해 손대지 않았다.
function sceneTextSpec(age: number): string {
  if (age <= 2) return "각 장면 텍스트는 한국어로 정확히 2문장, 한 문장은 15자 안팎의 아주 짧은 문장으로";
  if (age <= 6)
    return "각 장면 텍스트는 한국어로 4문장, 한 문장은 20~25자로(15자 안팎으로 짧게 끊지 말 것) — 장면 하나가 통째로 85자 안팎이 되게";
  if (age <= 9)
    return "각 장면 텍스트는 한국어로 5문장, 한 문장은 28~40자로(20자 안팎으로 짧게 끊지 말 것) — 장면 하나가 통째로 160자 안팎이 되게";
  return "각 장면 텍스트는 한국어로 5~6문장(최소 5문장), 복문을 섞어 읽는 맛이 있게";
}

// 아이들 호칭을 "서아와 도윤이" 형태로 연결.
// 앞 이름의 마지막 글자에 받침이 있으면 "과", 없으면 "와" (한글이 아니면 "와" 유지).
export function joinCallNames(names: string[]): string {
  return names.map(koreanCallName).reduce((acc, name, i) => {
    if (i === 0) return name;
    const code = acc.charCodeAt(acc.length - 1);
    const isHangul = code >= 0xac00 && code <= 0xd7a3;
    const particle = isHangul && (code - 0xac00) % 28 !== 0 ? "과" : "와";
    return `${acc}${particle} ${name}`;
  }, "");
}

export function buildStoryUserPrompt(
  children: StoryChild[],
  sceneCount: number,
  themeKo: string,
): string {
  if (children.length > 1) {
    return buildSiblingsStoryUserPrompt(children, sceneCount, themeKo);
  }
  const { name, gender, age } = children[0];
  const genderKo = gender === "girl" ? "여자아이" : "남자아이";
  const pronoun = gender === "girl" ? "she/her" : "he/him";
  const callName = koreanCallName(name);
  return `아이 이름: "${name}" (${age}세 ${genderKo}, ${pronoun})

연령 가이드 — 이 나이대에 맞게 **구성부터** 바꿔서 써줘. 톤만 바꾸는 게 아니야:
${ageStoryGuide(age)}

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
- **글맛 (아주 중요)**: 밋밋한 사건 나열은 금지. 소리 내어 읽어주기 좋은, 명작 그림책 같은 글로 써줘.
  · 매 장면에 주인공의 짧은 대사를 한 마디 이상 넣어줘 (또래 아이다운 생생한 말투로. 예: "우와, 저기 좀 봐!").
  · 장면마다 오감 묘사를 최소 하나 — 빛깔·소리·냄새·감촉을 구체적으로 (예: 솜사탕처럼 폭신한 구름, 짤랑짤랑 울리는 방울 소리, 달콤한 꿀빵 냄새).
  · 의성어·의태어로 리듬을 만들어줘. 부모가 읽을 때 입에 착착 붙게.
  · 문장 끝을 다양하게 — 모든 문장이 "~했어요"로 끝나는 단조로움 금지. 짧은 문장과 긴 문장을 섞어 호흡을 만들어.
  · **문체는 부모가 소리 내어 읽어주는 낭독체(~요/~어요/~답니다)로 전 연령 통일.** 나이가 많다고 "~했다" 같은 서술체로 쓰지 마 — 읽어주는 책이야.
  · 본문에 영어 단어를 섞지 마 (amber, magic 같은 말은 호박빛, 마법으로). 영어는 imagePrompt에만.
  · 반복되는 후렴을 쓸 땐 매 장면에 똑같은 문장을 그대로 붙여넣지 말고, 두세 장면 간격으로 조금씩 변주해줘.
  · 금지: 물건 여러 개 모아오기 심부름 퀘스트 구조, 대놓고 교훈을 설교하기, "알고 보니 꿈이었어요" 결말.
  · 감정 곡선: 설렘 → 아주 작은 긴장(무섭지 않게) → 스스로 해결한 뿌듯함 → 포근하고 나른한 마무리.
  · **이 '글맛' 항목이 위 연령 가이드와 부딪히면 언제나 연령 가이드를 따라.** (예: 아기는 긴장 없이 포근하게만)
- ${sceneTextSpec(age)} 써줘. 아이 이름 "${name}"을(를) 주인공으로 자연스럽게 등장시켜줘.
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

// 형제·자매(2~3명)가 함께 주인공인 이야기.
// 핵심: ① 모든 장면에 전원 등장 ② imagePrompt에서 각 아이를 사진 순서("the FIRST child")로 지칭
// ③ 아이별 기본 의상을 정해 모든 장면에 반복 (책 전체 일관성)
function buildSiblingsStoryUserPrompt(
  children: StoryChild[],
  sceneCount: number,
  themeKo: string,
): string {
  const ordinalsKo = ["첫째 사진", "둘째 사진", "셋째 사진"];
  const ordinalsEn = ["FIRST", "SECOND", "THIRD"];
  const roster = children
    .map((c, i) => {
      const genderKo = c.gender === "girl" ? "여자아이" : "남자아이";
      return `${i + 1}. "${c.name}" (${c.age}세 ${genderKo}) — 호칭 "${koreanCallName(c.name)}", imagePrompt에서는 "the ${ordinalsEn[i]} child (a ${c.age}-year-old ${c.gender})" (${ordinalsKo[i]}의 아이)`;
    })
    .join("\n");
  const callNames = children.map((c) => koreanCallName(c.name));
  const joined = joinCallNames(children.map((c) => c.name));
  const ages = children.map((c) => c.age);
  const maxAge = Math.max(...ages);
  const minAge = Math.min(...ages);

  return `주인공 아이들 (${children.length}명의 형제·자매):
${roster}

연령 가이드 — 이야기의 구성·문장 길이는 첫째(${maxAge}세) 기준으로 맞춰줘. 톤만 바꾸는 게 아니라 구성부터 이렇게:
${ageStoryGuide(maxAge)}${
    minAge <= 2
      ? `\n\n다만 막내(${minAge}세)는 아기이니, 막내가 나오는 대목은 다음을 지켜줘:\n${ageStoryGuide(minAge)}`
      : ""
  }
이야기 주제: ${themeKo}

이 아이들 전원을 함께 주인공으로, 위 주제의 세계에서 펼쳐지는 아주 따뜻하고 포근한 '취침 동화'를 만들어줘.
- 이야기의 배경, 등장 친구들, 기본 의상, 소품 모두 이 주제에 맞춰줘.
- 잠자기 전에 부모가 아이들에게 읽어주는 느낌. 부드럽고, 안심되고, 사랑이 느껴지게.
- **모든 장면에 아이들 전원이 함께 등장**해야 해. 서로 돕고 아끼는 다정한 남매/자매/형제의 모습을 담아줘. 각 장면에서 아이마다 각자의 역할과 행동이 있게 해줘 (한 명만 활약하고 나머지는 구경하는 구성 금지).
- 각 아이는 반드시 위의 호칭으로만 불러줘 ("${callNames.join('"처럼, "')}"처럼 조사를 자연스럽게 붙여서). 별명이나 다른 이름을 절대 지어내지 마.
- "그녀", "그", "아이들은" 같은 뭉뚱그린 대명사 대신 되도록 호칭으로 불러줘. 아이에게 읽어주는 말투로.
- 제목은 반드시 "${joined}의 "로 시작해 (예: "${joined}의 별빛 여행").
- 총 ${sceneCount}개의 장면으로 이야기가 자연스럽게 이어져야 해. (시작 → 작은 모험/발견 → 따뜻한 마무리와 잠자리)
- **줄거리 일관성 (중요)**: 이야기 전체를 관통하는 **하나의 목표나 사건**을 정하고, 모든 장면이 그 하나의 이야기 줄기 위에 있어야 해. 각 장면은 반드시 **바로 앞 장면의 결과로 자연스럽게 이어져야** 하고, 앞에서 벌어진 일과 모순되면 안 돼. 장면마다 새로운 등장인물·새로운 장소를 남발하지 말고(친구는 단짝 하나면 충분), 중간에 갑자기 다른 사건으로 튀지 마. 먼저 머릿속으로 전체 줄거리를 한 문장으로 정한 뒤에 장면을 나눠 써.
- **글맛 (아주 중요)**: 밋밋한 사건 나열은 금지. 소리 내어 읽어주기 좋은, 명작 그림책 같은 글로 써줘.
  · 매 장면에 주인공의 짧은 대사를 한 마디 이상 넣어줘 (또래 아이다운 생생한 말투로. 예: "우와, 저기 좀 봐!").
  · 장면마다 오감 묘사를 최소 하나 — 빛깔·소리·냄새·감촉을 구체적으로 (예: 솜사탕처럼 폭신한 구름, 짤랑짤랑 울리는 방울 소리, 달콤한 꿀빵 냄새).
  · 의성어·의태어로 리듬을 만들어줘. 부모가 읽을 때 입에 착착 붙게.
  · 문장 끝을 다양하게 — 모든 문장이 "~했어요"로 끝나는 단조로움 금지. 짧은 문장과 긴 문장을 섞어 호흡을 만들어.
  · **문체는 부모가 소리 내어 읽어주는 낭독체(~요/~어요/~답니다)로 전 연령 통일.** 나이가 많다고 "~했다" 같은 서술체로 쓰지 마 — 읽어주는 책이야.
  · 본문에 영어 단어를 섞지 마 (amber, magic 같은 말은 호박빛, 마법으로). 영어는 imagePrompt에만.
  · 반복되는 후렴을 쓸 땐 매 장면에 똑같은 문장을 그대로 붙여넣지 말고, 두세 장면 간격으로 조금씩 변주해줘.
  · 금지: 물건 여러 개 모아오기 심부름 퀘스트 구조, 대놓고 교훈을 설교하기, "알고 보니 꿈이었어요" 결말.
  · 감정 곡선: 설렘 → 아주 작은 긴장(무섭지 않게) → 스스로 해결한 뿌듯함 → 포근하고 나른한 마무리.
  · **이 '글맛' 항목이 위 연령 가이드와 부딪히면 언제나 연령 가이드를 따라.** (예: 아기는 긴장 없이 포근하게만)
- ${sceneTextSpec(maxAge)} 써줘.
- 마지막 장면은 아이들이 포근하게 잠드는 평화로운 결말로.

또한 삽화를 위해, 각 장면과 표지에 대한 "장면 묘사(imagePrompt)"를 **영어로** 써줘.
- imagePrompt에서 각 아이는 반드시 위에 정해준 지칭("the ${ordinalsEn.slice(0, children.length).join(' child", "the ')} child")으로만 불러 — 사진 순서와 아이가 정확히 매칭되어야 해.
- 먼저 이 동화의 주제와 각 아이의 나이에 어울리는 **아이별 기본 의상(base outfit)**을 하나씩 정해. 모든 imagePrompt에 아이별 기본 의상 묘사를 똑같이 반복해서 넣어 — 그래야 책 전체에서 각 아이의 옷이 일관되고, 아이를 구분하기도 쉬워.
- 모든 imagePrompt에 각 아이의 나이를 명시해. 의상·행동·자세 모두 그 나이에 자연스럽게.
- 주제에 어울리는 **단짝 친구 캐릭터(companion)** 하나도 정해. 이 친구는 이야기 글에도 등장시키고, **모든 imagePrompt에 똑같은 묘사로 반복**해서 넣어 — 책 전체에서 같은 친구로 그려지게.
- 각 imagePrompt에는 **아이마다 무엇을 하고 있는지(행동)**를 반드시 구체적으로 담아 — 함께 구름을 타고 나는 중, 언니가 동생 손을 잡고 별사탕을 따는 중처럼 서로 어울리는 행동으로. **배경 앞에 가만히 서 있는 장면은 금지.**
- 장면마다 이야기에 맞는 **소품/액세서리**를 더해줘. 소품은 장면 전개에 따라 자연스럽게 바뀌어도 좋아.
- imagePrompt에 아이들의 얼굴/머리/피부 같은 외모 묘사는 적지 마 (그건 사진에서 가져올 거야). 글자나 단어를 그려달라는 표현도 금지.
- 각 장면 묘사는 서로 다른 배경/상황으로 다채롭게, 하지만 하나의 이야기로 이어지게.

다음 JSON 형식으로만 답해:
{
  "title": "동화 제목 (한국어, 아이들 이름 포함)",
  "cover": { "imagePrompt": "표지용 영어 장면 묘사 — 아이들 전원 등장" },
  "scenes": [
    { "text": "1장면 한국어 텍스트", "imagePrompt": "1장면 영어 장면 묘사 — 아이들 전원 등장" }
    // ... 총 ${sceneCount}개
  ]
}`;
}
