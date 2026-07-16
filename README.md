# 우리 아이가 주인공 · 동화책

아이 **이름 + 성별 + 사진**을 넣으면, 업로드한 실제 사진을 참고해 아이를 닮은 **수채화 그림동화**(표지 + 6장면)를 만들어주는 앱.

- 사진 → 삽화 변환: OpenAI `gpt-image-1` (image edit) — 아이 **얼굴/머리만** 사진에서 유지하고, 옷·액세서리는 이야기 주제에 맞는 의상으로 갈아입힘 (기본 의상은 책 전체에서 일관, 소품은 장면별 변화)
- 이야기 생성: `gpt-4o-mini` — 따뜻한 취침 동화 톤, 한국어 6장면
- 삽화는 **한 장씩 순차 생성**하여 서버리스 타임아웃을 피하고 진행률을 보여줌

## 로컬 실행

```bash
npm install
cp .env.local.example .env.local   # 그리고 OPENAI_API_KEY 채우기
npm run dev                        # http://localhost:3466
```

## Vercel 배포

1. Vercel 프로젝트 생성 후 이 폴더 연결 (또는 `vercel` CLI)
2. 환경변수 `OPENAI_API_KEY` 추가
3. 배포

이미지 라우트(`/api/image`)는 `maxDuration = 60`으로 한 장당 60초 여유. 사진은 서버에 저장하지 않고 삽화 생성에만 사용.

## 프롬프트 튜닝

스타일 지문은 `lib/prompts.ts`의 `STYLE_BASE`에 모여 있음. 어떤 사진이든 예쁘게 나오도록 얼굴 유지 + 수채화 그림책 톤을 강제.
