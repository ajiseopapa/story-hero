// 샘플 갤러리 — 처음 온 사람이 결제 전에 그림체를 확인하는 페이지. 검색 노출도 노린다.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AGE_SAMPLES, SAMPLES, SAMPLE_H, SAMPLE_W, STYLE_SAMPLES } from "@/lib/samples";
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
          사진 한 장만 올리면 됩니다.
          <br />
          장면이 바뀌어도 <b>같은 얼굴</b>로 그려집니다.
        </p>
      </header>

      <section className="before-after">
        <h2>사진 한 장이면 됩니다</h2>
        <p className="hint">아래 그림은 왼쪽 사진 한 장으로 만든 것이에요.</p>
        <div className="ba-row">
          <figure className="ba-photo">
            <Image
              src="/samples/guide-photo.jpg"
              alt="동화책 제작에 사용한 아이 사진 예시"
              width={600}
              height={900}
              sizes="(max-width: 700px) 30vw, 200px"
            />
            <figcaption>올린 사진</figcaption>
          </figure>
          <div className="ba-arrow" aria-hidden="true">
            →
          </div>
          <figure>
            <Image
              src="/samples/guide-cover.jpg"
              alt="사진을 바탕으로 그린 동화책 표지"
              width={SAMPLE_W}
              height={SAMPLE_H}
              sizes="(max-width: 700px) 30vw, 220px"
              priority
            />
            <figcaption>표지</figcaption>
          </figure>
          <figure>
            <Image
              src="/samples/guide-scene.jpg"
              alt="사진을 바탕으로 그린 동화책 본문 장면"
              width={SAMPLE_W}
              height={SAMPLE_H}
              sizes="(max-width: 700px) 30vw, 220px"
            />
            <figcaption>본문 장면</figcaption>
          </figure>
        </div>
      </section>

      <section className="style-compare">
        <h2>나이에 맞게 그려드려요</h2>
        <p className="hint">
          같은 사진, 같은 장면입니다. 입력한 나이만 바꿔 그렸어요.
          <br />
          아기는 아기답게, 형아는 형아답게 — 체형과 얼굴이 나이를 따라갑니다.
        </p>
        <div className="style-row">
          {AGE_SAMPLES.map((a) => (
            <figure key={a.id}>
              <Image
                src={`/samples/${a.id}.jpg`}
                alt={`${a.label} 아이로 그린 동화 삽화 샘플`}
                width={SAMPLE_W}
                height={SAMPLE_H}
                sizes="(max-width: 700px) 45vw, 240px"
              />
              <figcaption>
                <b>{a.label}</b>
                {a.sub}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="style-compare">
        <h2>그림체를 고를 수 있어요</h2>
        <p className="hint">같은 그림에 재료만 바꿔 칠했습니다. 구도는 그대로예요.</p>
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
          이 페이지의 그림은 <b>모두 맨 위 사진 한 장</b>으로 만든 것이에요.
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
