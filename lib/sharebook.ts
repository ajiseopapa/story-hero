// 웹 스토리북(공유 링크) 공통 규약 — 서버 라우트와 클라이언트가 같이 쓴다.
// 링크는 "옵트인": 사용자가 [공유 링크 만들기]를 누른 경우에만 삽화·음성이 Blob에 저장된다.

export const SHARE_TTL_DAYS = 365; // 보관 기간 — 지나면 만료 안내 + 정리 크론이 삭제

// 카톡·SNS 미리보기(OG 태그)는 절대 주소를 요구한다.
export const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://kidsbook-story.vercel.app";
const DAY_MS = 24 * 60 * 60 * 1000;

export type SharePage = {
  kind: "cover" | "scene";
  text: string;
  hasImage: boolean;
  hasAudio: boolean;
};

// books/{id}/book.json 에 저장되는 책 한 권의 명세 (비공개 블롭)
export type ShareManifest = {
  v: 1;
  title: string;
  createdAt: number; // epoch ms
  deleteKey: string; // 만든 사람만 아는 삭제 키 (브라우저 IndexedDB에 보관)
  pages: SharePage[];
};

export const ID_RE = /^[0-9a-f]{32}$/;
export const ASSET_RE = /^(p\d{1,2}\.jpg|a\d{1,2})$/;
export const MAX_PAGES = 20;

export function bookPrefix(id: string): string {
  return `books/${id}/`;
}

export function manifestPath(id: string): string {
  return `${bookPrefix(id)}book.json`;
}

export function imagePath(id: string, i: number): string {
  return `${bookPrefix(id)}p${i}.jpg`;
}

export function audioPath(id: string, i: number): string {
  return `${bookPrefix(id)}a${i}`;
}

// 카톡 미리보기용 표지 그림 — 절대 주소여야 크롤러가 가져간다
export function coverImageUrl(id: string): string {
  return `${SITE_ORIGIN}/api/book/${id}/p0.jpg`;
}

export function expiresAt(createdAt: number): number {
  return createdAt + SHARE_TTL_DAYS * DAY_MS;
}

export function isExpired(createdAt: number, now = Date.now()): boolean {
  return now >= expiresAt(createdAt);
}

// 만료일을 "2027년 8월 11일"로
export function formatExpiry(createdAt: number): string {
  const d = new Date(expiresAt(createdAt));
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
