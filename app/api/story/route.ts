import { NextRequest, NextResponse } from "next/server";
import { getOpenAI } from "@/lib/openai";
import {
  DEVICE_COOKIE,
  FREE_DAILY_LIMIT,
  FREE_DEVICE_DAILY_LIMIT,
  FREE_IP_DAILY_LIMIT,
  consumeQuota,
  ipBucket,
  readDeviceId,
} from "@/lib/limits";
import {
  MAX_CHILDREN,
  buildStorySystemPrompt,
  buildStoryUserPrompt,
  koreanCallName,
  themeDescription,
  type Gender,
  type StoryChild,
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

const SCENE_COUNT = 10;

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
  // 무료 샘플 한도의 1차 신원인 기기 쿠키. 어느 경로로 응답이 끝나든 새 기기에는 쿠키를 심어,
  // 첫 요청부터 같은 기기로 집계되게 한다.
  const device = readDeviceId(req);
  const res = await generateStory(req, device.id);
  if (device.isNew) {
    res.cookies.set(DEVICE_COOKIE, device.id, {
      maxAge: 60 * 60 * 24 * 400, // 크롬이 허용하는 최대 수명
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  }
  return res;
}

async function generateStory(req: NextRequest, deviceId: string): Promise<NextResponse> {
  try {
    const { name, gender, age, theme, children } = (await req.json()) as {
      name?: string;
      gender?: Gender;
      age?: number;
      theme?: string;
      children?: { name?: string; gender?: Gender; age?: number }[];
    };

    // 신버전은 children 배열(1~3명), 구버전 단일 필드도 그대로 수용
    const rawKids =
      Array.isArray(children) && children.length > 0
        ? children.slice(0, MAX_CHILDREN)
        : [{ name, gender, age }];

    const kids: StoryChild[] = [];
    for (const k of rawKids) {
      const trimmed = (k.name ?? "").trim();
      if (!trimmed) {
        return NextResponse.json({ error: "아이 이름을 입력해주세요." }, { status: 400 });
      }
      if (k.gender !== "girl" && k.gender !== "boy") {
        return NextResponse.json({ error: "성별을 선택해주세요." }, { status: 400 });
      }
      // 나이는 0~10세 범위로 보정 (미지정 시 6세 기본, 0세는 유효한 값)
      const n = Number(k.age);
      const safeAge = Math.min(10, Math.max(0, Number.isFinite(n) ? Math.round(n) : 6));
      kids.push({ name: trimmed, gender: k.gender, age: safeAge });
    }

    const themeKo = themeDescription(theme ?? "");
    if (!themeKo) {
      return NextResponse.json({ error: "이야기 주제를 선택해주세요." }, { status: 400 });
    }

    // 일일 무료 샘플 한도 (기기 → IP 백스톱 → 전체 순서로 소진)
    if (!(await consumeQuota(`device/${deviceId}`, FREE_DEVICE_DAILY_LIMIT))) {
      return NextResponse.json(
        { error: "오늘 이 기기에서 만들 수 있는 무료 샘플을 모두 사용했어요. 내일 다시 만나요 🌙" },
        { status: 429 },
      );
    }
    if (!(await consumeQuota(`ip/${ipBucket(req)}`, FREE_IP_DAILY_LIMIT))) {
      return NextResponse.json(
        { error: "지금 같은 네트워크에서 만든 샘플이 많아 잠시 쉬어갈게요. 내일 다시 만나요 🌙" },
        { status: 429 },
      );
    }
    if (!(await consumeQuota("story", FREE_DAILY_LIMIT))) {
      return NextResponse.json(
        { error: "오늘 준비된 무료 샘플이 모두 소진됐어요. 내일 다시 찾아와주세요 🌙" },
        { status: 429 },
      );
    }

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      // 이야기 품질이 핵심이라 상위 모델 사용 (이야기당 몇십 원 수준).
      // gpt-5 계열은 temperature 커스텀 미지원 → 기본값 사용.
      model: "gpt-5.5",
      reasoning_effort: "medium", // low는 나열형 밋밋한 글이 나옴 — 구성력을 위해 medium (2026-08-08)
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildStorySystemPrompt() },
        { role: "user", content: buildStoryUserPrompt(kids, SCENE_COUNT, themeKo) },
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

    // 대명사 확정 치환·제목 보정은 단일 주인공일 때만 안전 (다인은 "그녀"가 누구인지 특정 불가,
    // 프롬프트에서 대명사 금지를 지시했으므로 그대로 신뢰)
    if (kids.length === 1) {
      const callName = koreanCallName(kids[0].name);
      return NextResponse.json({
        title: normalizeTitle(replacePronouns(parsed.title, callName), callName),
        cover: parsed.cover,
        scenes: scenes.map((s) => ({
          ...s,
          text: replacePronouns(s.text, callName),
        })),
      } satisfies StoryResult);
    }
    return NextResponse.json({
      title: parsed.title,
      cover: parsed.cover,
      scenes,
    } satisfies StoryResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
