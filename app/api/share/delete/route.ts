// 공유 링크 지우기 — 만든 사람의 브라우저에만 있는 deleteKey가 맞아야 지운다.
import { deleteBook, readManifest } from "@/lib/sharebook-server";
import { ID_RE } from "@/lib/sharebook";

export async function POST(req: Request): Promise<Response> {
  let body: { id?: unknown; deleteKey?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; deleteKey?: unknown };
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const { id, deleteKey } = body;
  if (typeof id !== "string" || !ID_RE.test(id) || typeof deleteKey !== "string") {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const manifest = await readManifest(id);
  if (!manifest) return Response.json({ ok: true }); // 이미 없으면 성공으로 본다
  if (manifest.deleteKey !== deleteKey) {
    return Response.json({ error: "이 링크를 지울 권한이 없어요." }, { status: 403 });
  }

  try {
    await deleteBook(id);
  } catch (err) {
    console.error("share delete failed:", err);
    return Response.json({ error: "링크를 지우지 못했어요." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
