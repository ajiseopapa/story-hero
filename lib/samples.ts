// 샘플 갤러리 — 결제 전에 "어떤 그림이 나오는지" 보여주기 위한 예시 삽화.
// 실제 아이 사진 없이 생성한 것이라 얼굴이 특정되지 않는다.
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
