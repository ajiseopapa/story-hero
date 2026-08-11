// 공유 링크 만들기 — 올라간 삽화·음성을 묶는 명세(book.json)를 저장한다.
import { put } from "@vercel/blob";
import {
  consumeQuota,
  ipBucket,
  SHARE_DAILY_LIMIT,
  SHARE_IP_DAILY_LIMIT,
} from "@/lib/limits";
import {
  expiresAt,
  ID_RE,
  manifestPath,
  MAX_PAGES,
  type ShareManifest,
  type SharePage,
} from "@/lib/sharebook";

const MAX_TEXT = 2000;

type Body = {
  id?: unknown;
  title?: unknown;
  deleteKey?: unknown;
  pages?: unknown;
};

function parsePages(raw: unknown): SharePage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PAGES) return null;
  const pages: SharePage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const p = item as Record<string, unknown>;
    if (p.kind !== "cover" && p.kind !== "scene") return null;
    if (typeof p.text !== "string" || p.text.length > MAX_TEXT) return null;
    pages.push({
      kind: p.kind,
      text: p.text,
      hasImage: p.hasImage === true,
      hasAudio: p.hasAudio === true,
    });
  }
  return pages;
}

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const { id, title, deleteKey } = body;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return Response.json({ error: "잘못된 링크 주소예요." }, { status: 400 });
  }
  if (typeof deleteKey !== "string" || !ID_RE.test(deleteKey)) {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim() || title.length > 120) {
    return Response.json({ error: "제목이 올바르지 않아요." }, { status: 400 });
  }
  const pages = parsePages(body.pages);
  if (!pages) {
    return Response.json({ error: "동화 내용이 올바르지 않아요." }, { status: 400 });
  }

  if (!(await consumeQuota(`share-ip/${ipBucket(req)}`, SHARE_IP_DAILY_LIMIT))) {
    return Response.json(
      { error: "오늘 만들 수 있는 공유 링크를 다 썼어요. 내일 다시 시도해주세요." },
      { status: 429 },
    );
  }
  if (!(await consumeQuota("share", SHARE_DAILY_LIMIT))) {
    return Response.json(
      { error: "오늘은 공유 링크 만들기가 많아 잠시 쉬어갈게요. 내일 다시 시도해주세요." },
      { status: 429 },
    );
  }

  const manifest: ShareManifest = {
    v: 1,
    title: title.trim(),
    createdAt: Date.now(),
    deleteKey,
    pages,
  };

  try {
    await put(manifestPath(id), JSON.stringify(manifest), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } catch (err) {
    console.error("share manifest save failed:", err);
    return Response.json({ error: "공유 링크를 만들지 못했어요." }, { status: 500 });
  }

  return Response.json({ path: `/book/${id}`, expiresAt: expiresAt(manifest.createdAt) });
}
