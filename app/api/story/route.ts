import { NextRequest, NextResponse } from "next/server";
import { getOpenAI } from "@/lib/openai";
import {
  buildStorySystemPrompt,
  buildStoryUserPrompt,
  koreanCallName,
  themeDescription,
  type Gender,
} from "@/lib/prompts";

export const runtime = "nodejs";
// gpt-5.5 이야기 생성이 30초+ 걸림 — 콜드스타트 포함 60초를 넘길 수 있어 여유 확보
// (Vercel Fluid Compute에서 Hobby도 최대 300초 허용)
export const maxDuration = 300;

type StoryScene = { text: string; imagePrompt: string };
type StoryResult = {
  title: string;
  cover: { imagePrompt: string };
  scenes: StoryScene[];
};

const SCENE_COUNT = 6;

// 모델이 프롬프트를 무시하고 쓰는 대명사(그녀/그는 등)를 호칭으로 확정 치환.
// "그 순간", "그런" 같은 지시어는 건드리지 않도록 단어 단위로만 매칭.
function replacePronouns(text: string, callName: string): string {
  return text
    .replace(/그녀(는|가|를|의|에게|와|도|랑|처럼)?/g, (_, p) => callName + (p ?? ""))
    .replace(
      /(^|[^가-힣])그(는|가|를|에게)(?![가-힣])/g,
      (_, pre, p) => `${pre}${callName}${p}`,
    );
}

// 제목이 "정안이별길"처럼 이름 뒤에 조사 없이 단어가 바로 붙으면
// 엉뚱한 단어("이별")로 읽힐 수 있어 "의 "를 끼워넣는다 → "정안이의 별길".
function normalizeTitle(title: string, callName: string): string {
  if (!title.startsWith(callName)) return title;
  const rest = title.slice(callName.length);
  if (rest && !/^[의와랑는가도에게,\s~!…·:∼-]/.test(rest)) {
    return `${callName}의 ${rest.trim()}`;
  }
  return title;
}

export async function POST(req: NextRequest) {
  try {
    const { name, gender, age, theme } = (await req.json()) as {
      name?: string;
      gender?: Gender;
      age?: number;
      theme?: string;
    };

    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      return NextResponse.json({ error: "아이 이름을 입력해주세요." }, { status: 400 });
    }
    if (gender !== "girl" && gender !== "boy") {
      return NextResponse.json({ error: "성별을 선택해주세요." }, { status: 400 });
    }
    // 나이는 3~13세 범위로 보정 (미지정 시 6세 기본)
    const safeAge = Math.min(13, Math.max(3, Math.round(Number(age) || 6)));
    const themeKo = themeDescription(theme ?? "");
    if (!themeKo) {
      return NextResponse.json({ error: "이야기 주제를 선택해주세요." }, { status: 400 });
    }

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      // 이야기 품질이 핵심이라 상위 모델 사용 (이야기당 몇십 원 수준).
      // gpt-5 계열은 temperature 커스텀 미지원 → 기본값 사용.
      model: "gpt-5.5",
      reasoning_effort: "low", // 창작 위주라 낮은 추론으로 지연 최소화
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildStorySystemPrompt() },
        { role: "user", content: buildStoryUserPrompt(trimmed, gender, safeAge, SCENE_COUNT, themeKo) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: StoryResult;
    try {
      parsed = JSON.parse(raw) as StoryResult;
    } catch {
      return NextResponse.json(
        { error: "이야기 생성 결과를 해석하지 못했어요. 다시 시도해주세요." },
        { status: 502 },
      );
    }

    // 최소한의 정합성 보정
    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes.slice(0, SCENE_COUNT) : [];
    if (!parsed.title || scenes.length === 0 || !parsed.cover?.imagePrompt) {
      return NextResponse.json(
        { error: "이야기 형식이 올바르지 않아요. 다시 시도해주세요." },
        { status: 502 },
      );
    }

    const callName = koreanCallName(trimmed);
    return NextResponse.json({
      title: normalizeTitle(replacePronouns(parsed.title, callName), callName),
      cover: parsed.cover,
      scenes: scenes.map((s) => ({
        ...s,
        text: replacePronouns(s.text, callName),
      })),
    } satisfies StoryResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
