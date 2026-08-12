// 샘플 갤러리 — 결제 전에 "어떤 그림이 나오는지" 보여주기 위한 예시 삽화.
// 얼굴이 안 보이면 닮음(이 서비스의 유일한 해자)을 확인할 수 없다.
// 이 페이지의 그림은 전부 guide-photo.jpg 한 장으로 실제 파이프라인 그대로 생성했다.
// 얼굴이 여럿이면 "누구 얼굴이지?" 싶어 헷갈리므로 한 아이로 통일한다 (2026-08-12).
export type Sample = {
  id: string;
  label: string; // 이야기 주제
  caption: string; // 카드 아래 한 줄
};

export const SAMPLES: Sample[] = [
  { id: "space", label: "우주 여행", caption: "별 사이를 날아가는 밤" },
  { id: "sea", label: "해저 탐험", caption: "고래와 함께 헤엄치는 바다" },
  { id: "dino", label: "공룡 시대", caption: "안개 낀 골짜기의 친구들" },
  { id: "forest", label: "마법의 숲", caption: "빛나는 버섯길을 걷는 밤" },
  { id: "candy", label: "과자 나라", caption: "크림 언덕을 미끄러지는 날" },
  { id: "snow", label: "눈의 나라", caption: "썰매를 타고 내려오는 언덕" },
];

export const SAMPLE_W = 720;
export const SAMPLE_H = 1080;

// 그림체 비교 — 같은 아이·같은 장면(마법의 숲)을 그림체만 바꿔 그린 것.
export type StyleSample = { id: string; label: string; sub: string };

export const STYLE_SAMPLES: StyleSample[] = [
  { id: "realistic", label: "사실적 그림", sub: "가장 닮게 · 기본" },
  { id: "watercolor", label: "수채화", sub: "포근한 그림책" },
  { id: "pencil", label: "색연필", sub: "부드럽고 따뜻하게" },
  { id: "crayon", label: "크레파스", sub: "아이 그림책 질감" },
];
