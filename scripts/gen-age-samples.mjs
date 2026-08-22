// 나이 비교 샘플 4장 재생성 (public/samples/age-{1,4,7,10}.jpg)
//
//   node scripts/gen-age-samples.mjs           # 네 장 전부
//   node scripts/gen-age-samples.mjs 1 7       # 지정한 나이만
//
// ⭐이 장은 "나이만 바꾸면 이렇게 달라진다"를 보여주는 비교 컷이라
// 나이 말고는 아무것도 달라지면 안 된다. 예전 4장은 카메라 거리·포즈·달 위치·
// 파자마가 제각각이라 등신 차이가 아니라 줌 차이로 읽혔다 (2026-08-22).
// 그래서 구도·포즈·달·옷을 장면 설명에 못 박고, 나이만 인자로 바꾼다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { buildScenePrompt } from "../lib/prompts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");
const apiKey = /^OPENAI_API_KEY=(.+)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!apiKey) throw new Error(".env.local에 OPENAI_API_KEY가 없습니다.");

// 나이를 뺀 모든 변수를 고정하는 장면 지문.
// styleBase에 "가만히 서 있는 그림 금지"가 있어서, 구도 고정 지시는 마지막(=장면)에 둔다.
const SCENE = [
  "The child sits on a thick fluffy cloud in a warm sunset sky, laughing up at a crescent moon.",
  "FIXED COMPOSITION — this picture is one of four in a side-by-side comparison set, and everything except the child's age MUST be identical across all four:",
  "Full-body framing: the ENTIRE body from the top of the head down to the bare toes is inside the frame, the child centred, seen straight on from eye level at the same medium distance, with a generous equal margin of sky above the head and cloud below the feet. Do NOT crop, do NOT zoom in, do NOT turn it into a close-up bust portrait — the whole standing height of the child must be readable so their body proportions can be compared.",
  "Pose — IDENTICAL in all four pictures regardless of age: sitting upright facing the viewer ON TOP of the cloud (never perched on its edge with the legs hanging down over the side), both legs STRAIGHT out in front and slightly apart with the knees NOT bent and both bare soles visible, both hands resting flat on the cloud beside the hips, head tilted slightly toward the moon, mouth open in a happy laugh. The full standing length of the legs must be readable so that height can be compared across the set.",
  "The crescent moon is in the UPPER LEFT of the frame — a pale gold crescent with a gentle sleeping face, eyes closed and a soft smile. Small gold stars are scattered across the sky.",
  "Costume: cream-coloured two-piece pyjamas (long-sleeved top and long pants) printed with small gold stars, barefoot.",
  "Background: dusky lavender-and-peach sunset clouds filling the whole frame.",
].join(" ");

const AGES = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [1, 4, 7, 10];

const photo = fs.readFileSync(path.join(root, "public/samples/guide-photo.jpg"));
const openai = new OpenAI({ apiKey });
const outDir = path.join(root, "scripts/.out");
fs.mkdirSync(outDir, { recursive: true });

for (const age of AGES) {
  const name = `age-${age}`;
  // 실제 고객 장면 삽화와 같은 조건(medium)으로 뽑아야 샘플이 결과물을 정직하게 대변한다.
  const prompt = buildScenePrompt(SCENE, [{ age, gender: "boy" }], "realistic");
  console.log(`[${name}] 생성 중…`);
  const result = await openai.images.edit({
    model: "gpt-image-1.5",
    image: await toFile(photo, "child1.jpg", { type: "image/jpeg" }),
    prompt,
    size: "1024x1536",
    quality: "medium",
    input_fidelity: "high",
  });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error(`[${name}] 이미지 응답이 비었습니다.`);
  const png = Buffer.from(b64, "base64");
  fs.writeFileSync(path.join(outDir, `${name}.png`), png);
  const jpg = path.join(root, `public/samples/${name}.jpg`);
  await sharp(png).resize(720, 1080).jpeg({ quality: 88 }).toFile(jpg);
  console.log(`[${name}] 저장: ${jpg}`);
}
