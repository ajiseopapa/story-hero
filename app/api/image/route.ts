import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { getOpenAI } from "@/lib/openai";
import { MAX_CHILDREN, buildCoverPrompt, buildScenePrompt, type ChildSpec } from "@/lib/prompts";
import { IMAGE_DAILY_LIMIT, consumeQuota } from "@/lib/limits";

export const runtime = "nodejs";
// gpt-image-1은 한 장에 60~90초 걸릴 수 있음 (Vercel Fluid Compute에서 Hobby도 최대 300초 허용)
export const maxDuration = 300;

// data URL(base64) → Buffer + mime
function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function POST(req: NextRequest) {
  try {
    const { photo, photos, imagePrompt, kind, age, gender, children } = (await req.json()) as {
      photo?: string; // 구버전 단일 사진 (결제 복원 초안 호환)
      photos?: string[]; // 신버전: 아이별 사진 1~3장 (children과 같은 순서)
      imagePrompt?: string;
      kind?: "cover" | "scene";
      age?: number;
      gender?: "girl" | "boy";
      children?: { age?: number; gender?: "girl" | "boy" }[];
    };

    const photoList = (
      Array.isArray(photos) && photos.length > 0 ? photos : photo ? [photo] : []
    ).slice(0, MAX_CHILDREN);
    if (photoList.length === 0) {
      return NextResponse.json({ error: "사진이 필요합니다." }, { status: 400 });
    }
    if (!imagePrompt) {
      return NextResponse.json({ error: "장면 설명이 없습니다." }, { status: 400 });
    }

    const files = [];
    for (let i = 0; i < photoList.length; i++) {
      const parsed = parseDataUrl(photoList[i]);
      if (!parsed) {
        return NextResponse.json({ error: "사진 형식이 올바르지 않습니다." }, { status: 400 });
      }
      const ext = parsed.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
      files.push(await toFile(parsed.buffer, `child${i + 1}.${ext}`, { type: parsed.mime }));
    }

    // 나이/성별은 예전 초안(결제 복원)엔 없을 수 있어 기본값으로 보정 (0세는 유효)
    const clampAge = (v: unknown) => {
      const n = Number(v);
      return Math.min(10, Math.max(0, Number.isFinite(n) ? Math.round(n) : 6));
    };
    const rawKids =
      Array.isArray(children) && children.length > 0 ? children : [{ age, gender }];
    // 사진 수와 아이 수를 맞춘다 (모자라면 기본값으로 채움)
    const cast: ChildSpec[] = photoList.map((_, i) => ({
      age: clampAge(rawKids[i]?.age),
      gender: rawKids[i]?.gender === "boy" ? "boy" : "girl",
    }));

    // 일일 삽화 생성 백스톱 (직접 호출 남용·폭주 방지, 정상 사용량보다 넉넉하게)
    if (!(await consumeQuota("image", IMAGE_DAILY_LIMIT))) {
      return NextResponse.json(
        { error: "오늘 그림을 그릴 수 있는 양이 모두 소진됐어요. 잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    }

    const prompt =
      kind === "cover"
        ? buildCoverPrompt(imagePrompt, cast)
        : buildScenePrompt(imagePrompt, cast);

    const openai = getOpenAI();
    const result = await openai.images.edit({
      model: "gpt-image-1.5", // ChatGPT 이미지 생성과 같은 계열 모델
      image: files.length === 1 ? files[0] : files,
      prompt,
      size: "1024x1536", // 세로형 동화책 판형
      quality: kind === "cover" ? "high" : "medium", // 표지는 고품질
      // @ts-expect-error — SDK 타입에 아직 없지만 API가 지원: 사진 속 얼굴을 최대한 보존
      input_fidelity: "high",
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: "삽화 생성에 실패했어요." }, { status: 502 });
    }

    return NextResponse.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    // OpenAI 콘텐츠 정책/키 오류 등을 사용자에게 부드럽게 전달
    let message = "삽화를 그리는 중 오류가 났어요.";
    if (err instanceof OpenAI.APIError) {
      message = err.message || message;
    } else if (err instanceof Error) {
      message = err.message;
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
