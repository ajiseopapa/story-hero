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

// 나이 비교 — 같은 아이·같은 장면(구름 위)을 입력 나이만 바꿔 그린 것.
// 나이에 따라 등신·체형·얼굴 성숙도가 달라진다는 걸 눈으로 보여준다 (2026-08-13).
export type AgeSample = { id: string; label: string; sub: string };

export const AGE_SAMPLES: AgeSample[] = [
  { id: "age-1", label: "1세", sub: "아기 체형 · 4등신" },
  { id: "age-4", label: "4세", sub: "유아 체형 · 5등신" },
  { id: "age-8", label: "8세", sub: "초등 저학년 · 6등신" },
  { id: "age-10", label: "10세", sub: "초등 고학년 · 6등신 이상" },
];

// 그림체 비교 — 같은 아이·같은 장면(마법의 숲)을 그림체만 바꿔 그린 것.
// ⚠️사진에서 4장을 따로 그리면 구도·포즈까지 달라져 싸구려로 보인다.
// 사실적 그림 1장을 원본으로 두고 "같은 그림을 재료만 바꿔 다시 칠하기"로 만든다.
export type StyleSample = { id: string; label: string; sub: string };

export const STYLE_SAMPLES: StyleSample[] = [
  { id: "realistic", label: "사실적 그림", sub: "가장 닮게 · 기본" },
  { id: "watercolor", label: "수채화", sub: "포근한 그림책" },
  { id: "pencil", label: "색연필", sub: "부드럽고 따뜻하게" },
  { id: "crayon", label: "크레파스", sub: "아이 그림책 질감" },
];
