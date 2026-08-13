import { NextRequest, NextResponse } from "next/server";
import { consumeQuota, ipBucket, TTS_DAILY_LIMIT, TTS_IP_DAILY_LIMIT } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 60;

export type NarratorId = "grandpa" | "grandma" | "dad" | "mom";

// gpt-4o-mini-tts: voice(음색) + instructions(말투)로 낭독 페르소나를 만든다.
// 음색은 실제 한국어 청취 비교로 선정 (onyx/echo 남성 저음, sage/marin 여성).
const NARRATORS: Record<NarratorId, { voice: string; instructions: string }> = {
  grandpa: {
    voice: "onyx",
    instructions:
      "너는 손주에게 옛날이야기를 들려주는 다정한 한국인 할아버지야. 낮고 그윽한 목소리로 아주 천천히, 정감 있게 읽어줘. 정확하고 자연스러운 표준 한국어 발음으로.",
  },
  grandma: {
    voice: "sage",
    instructions:
      "너는 손주를 무릎에 앉히고 동화를 들려주는 포근한 한국인 할머니야. 부드럽고 따뜻한 목소리로 천천히 다정하게 읽어줘. 정확하고 자연스러운 표준 한국어 발음으로.",
  },
  dad: {
    voice: "echo",
    instructions:
      "너는 잠자리에서 아이에게 동화책을 읽어주는 다정한 한국인 아빠야. 듬직하면서도 따뜻한 목소리로, 등장인물마다 목소리를 살짝 바꿔가며 실감 나게 읽어줘.",
  },
  mom: {
    voice: "marin",
    instructions:
      "너는 아이를 재우며 동화책을 읽어주는 상냥한 한국인 엄마야. 맑고 부드러운 목소리로 천천히, 사랑을 담아 읽어줘. 정확하고 자연스러운 표준 한국어 발음으로.",
  },
};

export async function POST(req: NextRequest) {
  try {
    const { text, narrator } = (await req.json()) as {
      text?: string;
      narrator?: string;
    };

    const trimmed = (text ?? "").trim().slice(0, 1000); // 장면 텍스트는 짧음 — 과금 방어용 상한
    if (!trimmed) {
      return NextResponse.json({ error: "읽을 문장이 없어요." }, { status: 400 });
    }
    const persona = NARRATORS[narrator as NarratorId];
    if (!persona) {
      return NextResponse.json({ error: "목소리를 선택해주세요." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY 환경변수가 없습니다." }, { status: 500 });
    }

    // 일일 한도 (IP별 → 전체 순서로 소진). 무료 샘플 버킷과 섞이지 않게 tts 전용 키를 쓴다.
    if (!(await consumeQuota(`tts-ip/${ipBucket(req)}`, TTS_IP_DAILY_LIMIT))) {
      return NextResponse.json(
        { error: "오늘 이 기기에서 들을 수 있는 만큼 다 들었어요. 내일 다시 들려주세요 🌙" },
        { status: 429 },
      );
    }
    if (!(await consumeQuota("tts", TTS_DAILY_LIMIT))) {
      return NextResponse.json(
        { error: "지금은 읽어주기 이용이 많아요. 잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    }

    // openai SDK(4.77) 타입에 instructions 파라미터가 없어 REST를 직접 호출한다.
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: persona.voice,
        input: trimmed,
        instructions: persona.instructions,
        response_format: "mp3",
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("TTS 실패:", res.status, detail);
      return NextResponse.json(
        { error: "목소리를 만들지 못했어요. 잠시 후 다시 시도해주세요." },
        { status: 502 },
      );
    }

    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
