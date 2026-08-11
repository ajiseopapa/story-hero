// 샘플 갤러리 — 처음 온 사람이 결제 전에 그림체를 확인하는 페이지. 검색 노출도 노린다.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SAMPLES, SAMPLE_H, SAMPLE_W } from "@/lib/samples";
import { SITE_ORIGIN } from "@/lib/sharebook";

const TITLE = "동화책 샘플 보기 · 키즈북";
const DESCRIPTION =
  "키즈북이 그려주는 수채화 그림동화 샘플을 미리 보세요. 우주·바다·공룡·마법의 숲 등 12가지 이야기 주제를 아이 사진으로 만들어 드립니다.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_ORIGIN}/samples` },
  openGraph: {
    type: "website",
    siteName: "키즈북",
    url: `${SITE_ORIGIN}/samples`,
    title: TITLE,
    description: DESCRIPTION,
    locale: "ko_KR",
  },
};

export default function SamplesPage() {
  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">샘플 보기 ✨</span>
        <h1>이런 그림이 나와요</h1>
        <p>
          모든 삽화는 <b>손으로 그린 듯한 수채화</b>로 그려집니다.
          <br />
          아래 그림의 주인공 자리에 <b>우리 아이 얼굴</b>이 들어갑니다.
        </p>
      </header>

      <section className="sample-grid">
        {SAMPLES.map((s) => (
          <figure key={s.id}>
            <Image
              src={`/samples/${s.id}.jpg`}
              alt={`${s.label} 주제의 수채화 동화 삽화 샘플`}
              width={SAMPLE_W}
              height={SAMPLE_H}
              sizes="(max-width: 700px) 45vw, 240px"
            />
            <figcaption>
              <b>{s.label}</b>
              {s.caption}
            </figcaption>
          </figure>
        ))}
      </section>

      <section className="card" style={{ textAlign: "center" }}>
        <p className="hint" style={{ fontSize: 16, lineHeight: 1.8, marginBottom: 16 }}>
          위 그림들은 <b>아이 사진 없이</b> 만든 예시라 얼굴이 보이지 않아요.
          <br />
          사진을 올리시면 <b>그 아이를 닮은 얼굴</b>로 그려집니다.
          <br />
          표지는 무료니까 얼굴을 먼저 보고 결정하세요.
        </p>
        <Link className="btn" href="/" style={{ display: "inline-block" }}>
          우리 아이로 만들어보기 🪄
        </Link>
      </section>
    </main>
  );
}
