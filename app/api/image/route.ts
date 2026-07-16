import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { getOpenAI } from "@/lib/openai";
import { buildCoverPrompt, buildScenePrompt } from "@/lib/prompts";

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
    const { photo, imagePrompt, kind, age, gender } = (await req.json()) as {
      photo?: string;
      imagePrompt?: string;
      kind?: "cover" | "scene";
      age?: number;
      gender?: "girl" | "boy";
    };

    if (!photo) {
      return NextResponse.json({ error: "사진이 필요합니다." }, { status: 400 });
    }
    if (!imagePrompt) {
      return NextResponse.json({ error: "장면 설명이 없습니다." }, { status: 400 });
    }

    const parsed = parseDataUrl(photo);
    if (!parsed) {
      return NextResponse.json({ error: "사진 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const ext = parsed.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const file = await toFile(parsed.buffer, `child.${ext}`, { type: parsed.mime });

    // 나이/성별은 예전 초안(결제 복원)엔 없을 수 있어 기본값으로 보정
    const safeAge = Math.min(13, Math.max(3, Math.round(Number(age) || 6)));
    const safeGender: "girl" | "boy" = gender === "boy" ? "boy" : "girl";
    const prompt =
      kind === "cover"
        ? buildCoverPrompt(imagePrompt, safeAge, safeGender)
        : buildScenePrompt(imagePrompt, safeAge, safeGender);

    const openai = getOpenAI();
    const result = await openai.images.edit({
      model: "gpt-image-1.5", // ChatGPT 이미지 생성과 같은 계열 모델
      image: file,
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
