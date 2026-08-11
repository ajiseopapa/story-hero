// 공유 링크로 열리는 웹 스토리북. 링크를 아는 사람만 볼 수 있고 검색엔진에는 노출하지 않는다.
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { coverImageUrl, formatExpiry, ID_RE, isExpired, SITE_ORIGIN } from "@/lib/sharebook";
import { readManifest } from "@/lib/sharebook-server";
import BookViewer from "./viewer";

export const dynamic = "force-dynamic"; // 지워지거나 만료된 링크가 캐시로 살아있지 않도록

type Params = { params: Promise<{ id: string }> };

// generateMetadata와 페이지가 같은 요청에서 명세를 두 번 읽지 않게 캐시
const loadBook = cache(async (id: string) => (ID_RE.test(id) ? readManifest(id) : null));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const book = await loadBook(id);
  if (!book || isExpired(book.createdAt)) {
    return { title: "키즈북", robots: { index: false, follow: false } };
  }

  // 카톡·SNS로 링크를 보냈을 때 표지 그림이 미리보기로 뜨게 한다.
  // (검색엔진에는 여전히 노출하지 않는다 — noindex는 그대로)
  const title = `《 ${book.title} 》`;
  const description = "우리 아이가 주인공인 그림동화예요. 그림을 넘기며 목소리로 들어보세요 💛";
  const cover = book.pages[0]?.hasImage ? coverImageUrl(id) : undefined;

  return {
    title: `${book.title} · 키즈북`,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "article",
      siteName: "키즈북",
      url: `${SITE_ORIGIN}/book/${id}`,
      title,
      description,
      locale: "ko_KR",
      images: cover ? [{ url: cover, width: 1024, height: 1536, alt: book.title }] : undefined,
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title,
      description,
      images: cover ? [cover] : undefined,
    },
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
