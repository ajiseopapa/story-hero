// 옛 Vercel Blob(읽기만 되는 정지 스토어)에서 Supabase Storage로 책·후기 복사. 2026-09-05 1회용.
//   node scripts/migrate-blob-to-supabase.mjs          # 복사
//   node scripts/migrate-blob-to-supabase.mjs --check  # 복사 결과 대조만
import { get, list } from "@vercel/blob";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
process.env.BLOB_READ_WRITE_TOKEN = env.BLOB_READ_WRITE_TOKEN;
const BASE = env.SUPABASE_URL + "/storage/v1";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "kidsbook";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
const checkOnly = process.argv.includes("--check");

async function existsInSupabase(path) {
  const res = await fetch(`${BASE}/object/${BUCKET}/${enc(path)}?nocache=${Math.random()}`, {
    method: "HEAD",
    headers: H,
  });
  return res.ok ? Number(res.headers.get("content-length")) : null;
}

let copied = 0, skipped = 0, failed = 0, missing = 0;
for (const prefix of ["books/", "reviews/"]) {
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 500 });
    for (const b of page.blobs) {
      const have = await existsInSupabase(b.pathname);
      if (checkOnly) {
        if (have === null || have !== b.size) { missing++; console.log("MISSING/DIFF", b.pathname, b.size, have); }
        continue;
      }
      if (have === b.size) { skipped++; continue; }
      try {
        const src = await get(b.pathname, { access: "private", useCache: false });
        if (!src || src.statusCode !== 200 || !src.stream) throw new Error("blob read " + src?.statusCode);
        const buf = Buffer.from(await new Response(src.stream).arrayBuffer());
        const res = await fetch(`${BASE}/object/${BUCKET}/${enc(b.pathname)}`, {
          method: "POST",
          headers: { ...H, "content-type": b.contentType || "application/octet-stream", "x-upsert": "true" },
          body: buf,
        });
        if (!res.ok) throw new Error("put " + res.status + " " + (await res.text()).slice(0, 120));
        copied++;
        process.stdout.write(".");
      } catch (e) {
        failed++;
        console.log("\nFAIL", b.pathname, e.message);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
console.log(checkOnly ? `\ncheck done: missing/diff ${missing}` : `\ncopied ${copied}, skipped ${skipped}, failed ${failed}`);
