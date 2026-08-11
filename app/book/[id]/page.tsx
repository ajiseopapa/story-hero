// 공유 링크로 열리는 웹 스토리북. 링크를 아는 사람만 볼 수 있고 검색엔진에는 노출하지 않는다.
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatExpiry, ID_RE, isExpired } from "@/lib/sharebook";
import { readManifest } from "@/lib/sharebook-server";
import BookViewer from "./viewer";

export const dynamic = "force-dynamic"; // 지워지거나 만료된 링크가 캐시로 살아있지 않도록

type Params = { params: Promise<{ id: string }> };

// generateMetadata와 페이지가 같은 요청에서 명세를 두 번 읽지 않게 캐시
const loadBook = cache(async (id: string) => (ID_RE.test(id) ? readManifest(id) : null));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const book = await loadBook(id);
  return {
    title: book ? `${book.title} · 키즈북` : "키즈북",
    robots: { index: false, follow: false },
  };
}

export default async function SharedBookPage({ params }: Params) {
  const { id } = await params;
  const book = await loadBook(id);
  if (!book) notFound();

  if (isExpired(book.createdAt)) {
    return (
      <main className="wrap">
        <section className="card" style={{ textAlign: "center" }}>
          <h1 className="book-title">보관 기간이 끝났어요</h1>
          <p className="hint" style={{ lineHeight: 1.9 }}>
            공유 링크는 만든 날부터 1년 동안만 열려 있어요.
            <br />이 동화책은 보관 기간이 지나 그림과 목소리를 모두 지웠습니다.
          </p>
          <a className="btn" href="/" style={{ display: "inline-block", marginTop: 14 }}>
            우리 아이 동화책 만들러 가기
          </a>
        </section>
      </main>
    );
  }

  return (
    <BookViewer
      id={id}
      title={book.title}
      pages={book.pages}
      expiry={formatExpiry(book.createdAt)}
    />
  );
}
