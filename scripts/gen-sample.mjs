// 샘플 갤러리 삽화 재생성 스크립트 (public/samples/*.jpg)
//
//   node scripts/gen-sample.mjs <장면설명.txt> <출력이름> [quality]
//   예) node scripts/gen-sample.mjs scene.txt candy high
//
// 실제 서비스와 똑같은 파이프라인(guide-photo.jpg + lib/prompts.ts + gpt-image-1.5)으로
// 그린 뒤 720x1080 jpg로 줄여 public/samples/<출력이름>.jpg 에 저장한다.
// 원본 png는 scripts/.out/ 에 남긴다(비교용, git 제외).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { buildScenePrompt } from "../lib/prompts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// .env.local에서 키만 읽는다 (next 밖에서 도는 스크립트라 직접 파싱)
const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");
const apiKey = /^OPENAI_API_KEY=(.+)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!apiKey) throw new Error(".env.local에 OPENAI_API_KEY가 없습니다.");

const [sceneFile, outName, quality = "high"] = process.argv.slice(2);
if (!sceneFile || !outName) {
  throw new Error("사용법: node scripts/gen-sample.mjs <장면설명.txt> <출력이름> [quality]");
}

const scene = fs.readFileSync(sceneFile, "utf8").trim();
// 샘플의 아이는 guide-photo.jpg 한 장으로 통일 (얼굴이 여럿이면 헷갈린다)
const prompt = buildScenePrompt(scene, [{ age: 6, gender: "boy" }], "realistic");

const photo = fs.readFileSync(path.join(root, "public/samples/guide-photo.jpg"));
const openai = new OpenAI({ apiKey });

console.log(`[${outName}] 생성 중… (quality=${quality})`);
const result = await openai.images.edit({
  model: "gpt-image-1.5",
  image: await toFile(photo, "child1.jpg", { type: "image/jpeg" }),
  prompt,
  size: "1024x1536",
  quality,
  input_fidelity: "high",
});

const b64 = result.data?.[0]?.b64_json;
if (!b64) throw new Error("이미지 응답이 비었습니다.");
const png = Buffer.from(b64, "base64");

const outDir = path.join(root, "scripts/.out");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${outName}.png`), png);

const jpg = path.join(root, `public/samples/${outName}.jpg`);
await sharp(png).resize(720, 1080).jpeg({ quality: 88 }).toFile(jpg);
console.log(`[${outName}] 저장: ${jpg}`);
