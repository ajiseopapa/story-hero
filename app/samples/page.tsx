// 샘플 갤러리 — 처음 온 사람이 결제 전에 그림체를 확인하는 페이지. 검색 노출도 노린다.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SAMPLES, SAMPLE_H, SAMPLE_W, STYLE_SAMPLES } from "@/lib/samples";
import { SITE_ORIGIN } from "@/lib/sharebook";

const TITLE = "동화책 샘플 보기 · 키즈북";
const DESCRIPTION =
  "키즈북이 그려주는 그림동화 샘플을 미리 보세요. 사실적 그림·수채화·색연필·크레파스 4가지 그림체와 우주·바다·공룡·마법의 숲 등 12가지 이야기 주제를 아이 사진으로 만들어 드립니다.";

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
          아래 그림들은 <b>한 아이의 사진 한 장</b>으로 만든 것입니다.
          <br />
          장면이 바뀌어도 <b>같은 얼굴</b>로 그려집니다.
        </p>
      </header>

      <section className="style-compare">
        <h2>그림체를 고를 수 있어요</h2>
        <p className="hint">같은 아이, 같은 장면을 그림체만 바꿔 그렸습니다.</p>
        <div className="style-row">
          {STYLE_SAMPLES.map((s) => (
            <figure key={s.id}>
              <Image
                src={`/samples/style-${s.id}.jpg`}
                alt={`${s.label} 그림체로 그린 동화 삽화 샘플`}
                width={SAMPLE_W}
                height={SAMPLE_H}
                sizes="(max-width: 700px) 45vw, 240px"
              />
              <figcaption>
                <b>{s.label}</b>
                {s.sub}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <h2 className="sample-heading">이야기 주제도 골라요</h2>
      <section className="sample-grid">
        {SAMPLES.map((s) => (
          <figure key={s.id}>
            <Image
              src={`/samples/${s.id}.jpg`}
              alt={`${s.label} 주제의 동화 삽화 샘플`}
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
          위 샘플의 아이는 <b>실제 아이가 아니라 AI로 만든 가상 인물</b>이에요.
          <br />
          우리 아이 사진을 올리시면 <b>그 아이를 닮은 얼굴</b>로 그려집니다.
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
