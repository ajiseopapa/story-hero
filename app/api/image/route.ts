import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { getOpenAI } from "@/lib/openai";
import { MAX_CHILDREN, buildCoverPrompt, buildScenePrompt, type ChildSpec } from "@/lib/prompts";
import {
  COUPON_IMAGE_DAILY_LIMIT,
  IMAGE_DAILY_LIMIT,
  IMAGE_FREE_IP_DAILY_LIMIT,
  ORDER_IMAGE_LIMIT,
  consumeQuota,
  ipBucket,
} from "@/lib/limits";
import { ID_RE, consumeOrderImage, getOrder, tokenMatches } from "@/lib/orders";
import { alertAdmin } from "@/lib/alerts";
import { hasTestPass } from "@/lib/test-pass";
import { checkCoupon, normalizeCode } from "@/lib/coupons";
import { adminAlert, classifyOpenAIError, userMessage } from "@/lib/openai-error";

export const runtime = "nodejs";
// gpt-image-1은 한 장에 60~90초 걸릴 수 있음 (Vercel Fluid Compute에서 Hobby도 최대 300초 허용)
export const maxDuration = 300;

/** 테스트 통행증 전용 일일 상한 (무료 샘플 한 번에 2장이니 20번쯤 확인할 수 있다) */
const TEST_IMAGE_DAILY_LIMIT = Number(process.env.TEST_IMAGE_DAILY_LIMIT ?? "40");

// data URL(base64) → Buffer + mime
function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function POST(req: NextRequest) {
  try {
    const { photo, photos, imagePrompt, kind, age, gender, children, art, order, coupon } =
      (await req.json()) as {
        photo?: string; // 구버전 단일 사진 (결제 복원 초안 호환)
        photos?: string[]; // 신버전: 아이별 사진 1~3장 (children과 같은 순서)
        imagePrompt?: string;
        kind?: "cover" | "scene";
        age?: number;
        gender?: "girl" | "boy";
        children?: { age?: number; gender?: "girl" | "boy" }[];
        art?: string; // 그림체 (없으면 예전 초안 → 수채화)
        // 결제한 주문의 자격 증명 — 있으면 IP 한도 대신 주문별 한도를 쓴다
        order?: { id?: string; token?: string };
        // 무료 샘플 단계의 쿠폰 코드 — 유효하면 IP 한도 대신 쿠폰별 한도를 쓴다(/api/story와 짝)
        coupon?: string;
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

    // ----- 비용 방어 -----
    // 결제한 주문(자격 증명 제시)은 주문별 상한, 그 외(무료 샘플)는 IP별 일일 한도.
    // 예전엔 전역 한도뿐이라 스크립트 하나가 하루치를 소진해 유료 고객까지 막을 수 있었다.
    const testing = hasTestPass(req);
    let paidOrder = false;
    if (order?.id && order?.token) {
      const found = ID_RE.test(order.id) ? await getOrder(order.id) : null;
      if (!found || found.status !== "paid" || !tokenMatches(found.token, order.token)) {
        return NextResponse.json(
          { error: "주문 확인에 실패했어요. 새로고침 후 다시 시도해주세요." },
          { status: 403 },
        );
      }
      if (!(await consumeOrderImage(order.id, ORDER_IMAGE_LIMIT))) {
        return NextResponse.json(
          { error: "이 주문으로 그릴 수 있는 삽화 수를 넘었어요. 문의해주시면 도와드릴게요." },
          { status: 429 },
        );
      }
      paidOrder = true;
    } else if (!testing) {
      // 쿠폰 손님은 IP 한도 대신 쿠폰별 한도 — 이야기가 쿠폰으로 통과했는데 삽화가 IP에 막히면
      // 같은 문제가 한 칸 뒤에서 되풀이된다. 유효하지 않은 쿠폰은 그냥 무시하고 IP 한도로 센다.
      const couponCode = normalizeCode(coupon);
      const check = couponCode ? await checkCoupon(couponCode) : null;
      if (check?.ok) {
        if (!(await consumeQuota(`coupon-image/${couponCode}`, COUPON_IMAGE_DAILY_LIMIT))) {
          return NextResponse.json(
            { error: "이 쿠폰으로 오늘 그릴 수 있는 샘플 삽화를 다 썼어요. 마음에 드는 샘플을 열어주세요." },
            { status: 429 },
          );
        }
      } else if (!(await consumeQuota(`image-${ipBucket(req)}`, IMAGE_FREE_IP_DAILY_LIMIT))) {
        // 테스트 통행증은 IP 한도를 건너뛴다 (전체 한도는 아래에서 따로 센다)
        return NextResponse.json(
          { error: "오늘 무료로 그릴 수 있는 양을 다 쓰셨어요. 내일 다시 시도해주세요." },
          { status: 429 },
        );
      }
    }

    // 일일 삽화 생성 백스톱 (직접 호출 남용·폭주 방지, 정상 사용량보다 넉넉하게).
    // 통행증은 따로 센다 — 하루 확인하다 손님 몫을 깎아먹지 않게, 그러면서도 상한은 남게.
    if (testing) {
      if (!(await consumeQuota("image-test", TEST_IMAGE_DAILY_LIMIT))) {
        return NextResponse.json(
          { error: "오늘 테스트로 그릴 수 있는 양을 다 썼어요(관리자용 한도)." },
          { status: 429 },
        );
      }
    } else if (!(await consumeQuota("image", IMAGE_DAILY_LIMIT))) {
      return NextResponse.json(
        { error: "오늘 그림을 그릴 수 있는 양이 모두 소진됐어요. 잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    }

    const prompt =
      kind === "cover"
        ? buildCoverPrompt(imagePrompt, cast, art)
        : buildScenePrompt(imagePrompt, cast, art);

    const openai = getOpenAI();
    const result = await openai.images.edit({
      model: "gpt-image-1.5", // ChatGPT 이미지 생성과 같은 계열 모델
      image: files.length === 1 ? files[0] : files,
      prompt,
      size: "1024x1536", // 세로형 동화책 판형
      // 돈 낸 책의 표지만 high로 그린다. 무료 샘플 표지는 medium — high는 한 장에 수십 초가
      // 더 붙는데, 그 시간을 못 견디고 나가는 사람이 품질로 얻는 것보다 많았다(2026-09-01).
      quality: paidOrder && kind === "cover" ? "high" : "medium",
      // @ts-expect-error — SDK 타입에 아직 없지만 API가 지원: 사진 속 얼굴을 최대한 보존
      input_fidelity: "high",
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: "삽화 생성에 실패했어요." }, { status: 502 });
    }

    return NextResponse.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    console.error("image failed:", err instanceof Error ? err.message : err);
    const kind = classifyOpenAIError(err);
    const alert = adminAlert(kind, "삽화 생성");
    if (alert) await alertAdmin(kind, alert.subject, alert.body);
    // 콘텐츠 정책처럼 손님이 사진을 바꾸면 풀리는 오류는 원문이 도움이 된다(한국어로 온다).
    const fallback =
      err instanceof OpenAI.APIError && err.message
        ? err.message
        : "삽화를 그리는 중 오류가 났어요. 다시 시도해주세요.";
    return NextResponse.json({ error: userMessage(kind, fallback) }, { status: 500 });
  }
}
