/**
 * Supabase Storage 래퍼 (추가 패키지 없음, REST 직접 호출).
 *
 * 2026-09-05 Vercel Blob에서 옮김 — 무료 플랜의 작업 횟수를 넘겨 스토어가 "suspended"로
 * 쓰기가 막히자 공유 링크·자동 보관·후기 저장이 한꺼번에 죽었다. 이 파일이 책(books/)과
 * 후기(reviews/)를 비공개 버킷 하나에 담는다.
 *
 * ⚠️ 읽기는 앞단 CDN 캐시를 타서 방금 지운·덮어쓴 파일이 수십 초 옛 내용으로 돌아온다
 * (부갈FC에서 실제로 겪음). 그래서 읽을 때 ?nocache=<난수>를 붙여 캐시를 우회한다.
 *
 * 필요한 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (서버 전용 — 절대 클라이언트로 내보내지 말 것)
 */

export const BUCKET = "kidsbook";

function config(): { base: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { base: `${url}/storage/v1`, key };
}

export function isStorageConfigured(): boolean {
  return config() !== null;
}

function headers(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

function need(): { base: string; key: string } {
  const cfg = config();
  if (!cfg) throw new Error("storage not configured");
  return cfg;
}

function enc(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** 파일 하나 올리기(같은 경로면 덮어쓴다) */
export async function putObject(
  path: string,
  body: string | Blob | ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const { base, key } = need();
  const res = await fetch(`${base}/object/${BUCKET}/${enc(path)}`, {
    method: "POST",
    headers: headers(key, { "content-type": contentType, "x-upsert": "true" }),
    body: body as BodyInit,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`storage put ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export type StoredObject = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number | null;
  /** 마지막 수정 시각(ms). 헤더가 없으면 null */
  modifiedAt: number | null;
};

/** 파일 하나 읽기 — 없으면 null. CDN 캐시를 우회한다. */
export async function getObject(path: string): Promise<StoredObject | null> {
  const { base, key } = need();
  const nocache = Math.random().toString(36).slice(2);
  const res = await fetch(`${base}/object/${BUCKET}/${enc(path)}?nocache=${nocache}`, {
    headers: headers(key, { "cache-control": "no-cache" }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 404 || res.status === 400) {
    // body.cancel()은 Vercel 런타임에서 매달렸다(함수 300초 타임아웃, 2026-09-05) — 작은 오류 본문은 읽어서 버린다
    await res.text().catch(() => undefined);
    return null;
  }
  if (!res.ok || !res.body) {
    await res.text().catch(() => undefined);
    throw new Error(`storage get ${res.status}`);
  }
  const lm = res.headers.get("last-modified");
  const size = Number(res.headers.get("content-length"));
  return {
    stream: res.body,
    contentType: res.headers.get("content-type") || "application/octet-stream",
    size: Number.isFinite(size) && size > 0 ? size : null,
    modifiedAt: lm ? new Date(lm).getTime() || null : null,
  };
}

export async function getJson<T>(path: string): Promise<T | null> {
  const obj = await getObject(path);
  if (!obj) return null;
  return (await new Response(obj.stream).json()) as T;
}

export type StorageEntry = {
  name: string;
  /** 폴더면 null */
  id: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  size: number | null;
};

/** 폴더 한 단계 목록(재귀 아님). prefix는 "books/abc" 처럼 끝 슬래시 없이. */
export async function listObjects(prefix: string, limit = 1000): Promise<StorageEntry[]> {
  const { base, key } = need();
  const out: StorageEntry[] = [];
  for (let offset = 0; ; offset += limit) {
    const res = await fetch(`${base}/object/list/${BUCKET}`, {
      method: "POST",
      headers: headers(key, { "content-type": "application/json" }),
      body: JSON.stringify({
        prefix: prefix.replace(/\/$/, ""),
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`storage list ${res.status}`);
    const rows = (await res.json()) as {
      name: string;
      id: string | null;
      created_at?: string | null;
      updated_at?: string | null;
      metadata?: { size?: number } | null;
    }[];
    for (const r of rows) {
      out.push({
        name: r.name,
        id: r.id ?? null,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
        size: r.metadata?.size ?? null,
      });
    }
    if (rows.length < limit) break;
  }
  return out;
}

/** 여러 파일 지우기(경로 전체 지정). 없는 파일이 섞여 있어도 오류가 아니다. */
export async function deleteObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { base, key } = need();
  for (let i = 0; i < paths.length; i += 100) {
    const res = await fetch(`${base}/object/${BUCKET}`, {
      method: "DELETE",
      headers: headers(key, { "content-type": "application/json" }),
      body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }),
    });
    if (!res.ok) {
      throw new Error(`storage delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}

/**
 * 브라우저가 서버를 거치지 않고 바로 올릴 수 있는 1회용 서명 URL.
 * (Vercel 함수 요청 본문 4.5MB 제한을 피한다.) 유효 시간은 Supabase 기본 2시간.
 * 클라이언트는 이 URL로 PUT + content-type + x-upsert:true.
 */
export async function signUpload(path: string): Promise<string> {
  const { base, key } = need();
  const res = await fetch(`${base}/object/upload/sign/${BUCKET}/${enc(path)}`, {
    method: "POST",
    headers: headers(key, { "x-upsert": "true" }),
  });
  if (!res.ok) throw new Error(`storage sign ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { url: string };
  // 응답의 url은 "/object/upload/sign/..." 상대 경로
  return data.url.startsWith("http") ? data.url : `${base}${data.url}`;
}
