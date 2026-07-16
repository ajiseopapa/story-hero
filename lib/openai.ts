import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY 환경변수가 없습니다. .env.local 또는 Vercel 환경변수에 키를 넣어주세요.",
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}
