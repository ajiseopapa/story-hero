// 얼굴 지문(텍스트 앵커).
//
// 사진을 매 장면에 붙여도 모델이 사진을 "새로 해석"하는 폭이 남는다(2026-09-10 A/B에서 확인).
// 표지 그림을 앵커로 붙여 그 폭을 줄였지만, 표지 자체가 사진에서 벗어나면 그 편차가
// 나머지에 복제되는 약점이 있다 — 표지를 그리기 **전에** 사진을 말로 한 번 옮겨두면
// 표지부터 그 말을 지표로 그리게 된다.
//
// 책 한 권에 딱 한 번(표지 요청 안에서) 부르고, 결과는 초안에 담겨 모든 장면에 그대로 실린다.
// 실패하면 빈 배열 — 얼굴 지문은 있으면 좋은 것이지 없으면 못 그리는 것이 아니다.
import type OpenAI from "openai";

/** 지문 한 줄의 최대 길이. 모델이 장황해지면 프롬프트에서 스타일 지문을 밀어낸다. */
const MAX_CHARS = 900;

/** 길이를 자르되 문장 중간에서 끊지 않는다 — "…no visible freckles, moles, glas"로 끝나면 안 된다. */
function clip(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_CHARS) return t;
  const cut = t.slice(0, MAX_CHARS);
  const lastStop = cut.lastIndexOf(". ");
  return lastStop > MAX_CHARS * 0.5 ? cut.slice(0, lastStop + 1) : cut;
}

const SYSTEM = `You write short, factual appearance notes that an illustrator uses to keep a child's face consistent across the pages of one picture book.

For EACH photograph you are given, in the same order, write 3-4 English sentences covering ONLY what is visibly true of that child's head:
- the shape of the face and jaw, and where it is widest
- the eyes: shape, how they are set and spaced, eyelid crease or lack of one, eyebrow shape and thickness
- the nose and the mouth, and the teeth if they show
- the hair: exact colour, texture, length, the parting, and the precise shape of the fringe/bangs across the forehead
- skin tone, and any distinctive marks that would be visible in a drawing (moles, freckles, dimples, a gap between teeth, glasses)

Rules:
- Describe ONLY the head and hair. Never mention clothing, background, pose, expression, camera or lighting.
- Never state or guess the child's age, height, build or weight. The illustrator is told the age separately, and your note must stay true whatever age is drawn.
- Never guess nationality, ethnicity, family, name, or anything about who the child is. Visible appearance only.
- Write plain declarative sentences an artist can follow. No adjectives of praise, no "cute", no storytelling.

Reply with JSON only: {"faces": ["note for the first photo", "note for the second photo", ...]} — exactly one string per photograph, in the given order.`;

/**
 * 사진에서 얼굴 지문을 뽑는다. 사진 순서 = 반환 순서.
 * 실패하거나 개수가 안 맞으면 빈 배열을 돌려준다(호출부는 지문 없이 그대로 그린다).
 */
export async function describeFaces(
  openai: OpenAI,
  photoDataUrls: string[],
): Promise<string[]> {
  if (photoDataUrls.length === 0) return [];
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.5",
      // 관찰을 옮겨 적는 일이라 깊이 생각할 게 없다 — 표지 앞에 붙는 지연을 최소로.
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${photoDataUrls.length} photograph(s) follow, in order. Write one note for each.`,
            },
            ...photoDataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url, detail: "high" as const },
            })),
          ],
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { faces?: unknown };
    if (!Array.isArray(parsed.faces)) return [];
    const faces = parsed.faces.map((f) => (typeof f === "string" ? clip(f) : ""));
    // 한 명이라도 비면 순서가 어긋난 것 — 반쪽짜리를 쓰느니 통째로 버린다
    if (faces.length !== photoDataUrls.length || faces.some((f) => f.length < 40)) return [];
    return faces;
  } catch (err) {
    // 얼굴 지문이 없다고 삽화를 못 그리는 건 아니다 — 조용히 포기하고 예전 경로로 간다
    console.error("face anchor failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
