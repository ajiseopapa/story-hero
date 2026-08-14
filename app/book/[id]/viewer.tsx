"use client";

// 공유 링크로 열리는 웹 스토리북 뷰어 — 그림 넘기기 + 이어읽기.
// 삽화·음성은 /api/book/{id}/{파일}로 하나씩 받아온다(비공개 블롭 경유).
import { useCallback, useEffect, useRef, useState } from "react";
import type { SharePage } from "@/lib/sharebook";

type Props = {
  id: string;
  title: string;
  pages: SharePage[];
  expiry: string;
};

export default function BookViewer({ id, title, pages, expiry }: Props) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false); // iOS 사파리는 audio/webm 재생 불가
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = pages.length;
  const page = pages[current];
  const imgSrc = (i: number) => `/api/book/${id}/p${i}.jpg`;
  const audioSrc = (i: number) => `/api/book/${id}/a${i}`;

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    audioRef.current?.pause();
  }, []);

  // 첫 재생은 사용자의 클릭 안에서 Audio를 만들어야 iOS가 막지 않는다
  const playFrom = useCallback(
    (start: number) => {
      if (!audioRef.current) {
        const el = new Audio();
        el.play().catch(() => {});
        audioRef.current = el;
      }
      const el = audioRef.current;
      playingRef.current = true;
      setPlaying(true);
      setAudioFailed(false);

      // 재생 실패(iOS 사파리의 webm 미지원 등) 시 조용히 멈추지 말고 안내를 띄운다
      const fail = () => {
        stop();
        setAudioFailed(true);
      };

      const step = (i: number) => {
        if (!playingRef.current) return;
        if (i >= total) {
          stop();
          return;
        }
        setCurrent(i);
        if (!pages[i].hasAudio) {
          timerRef.current = setTimeout(() => step(i + 1), 2500);
          return;
        }
        el.src = audioSrc(i);
        el.onended = () => {
          if (playingRef.current) step(i + 1);
        };
        el.onerror = fail;
        el.play().catch(fail);
      };
      step(start);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, total, stop, id],
  );

  useEffect(() => stop, [stop]);

  const go = (n: number) => {
    stop();
    setCurrent(Math.max(0, Math.min(total - 1, n)));
  };

  const hasAnyAudio = pages.some((p) => p.hasAudio);

  return (
    <main className="wrap">
      <section className="book">
        <h1 className="book-title">《 {title} 》</h1>

        <div className="page">
          <div className="illus">
            {page.hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imgSrc(current)}
                alt={page.kind === "cover" ? "표지" : `${current}번째 장면`}
              />
            ) : (
              <div className="mini-spin" />
            )}
          </div>
          <div className="caption">
            {page.kind === "cover" ? `✦ ${title} ✦` : page.text}
          </div>
          {page.kind === "cover" && (
            <div className="cover-caption">우리 아이가 주인공인 그림동화</div>
          )}
        </div>

        <div className="nav">
          <button onClick={() => go(current - 1)} disabled={current === 0}>
            ← 이전
          </button>
          <span className="pagenum">
            {current + 1} / {total}
          </span>
          <button onClick={() => go(current + 1)} disabled={current === total - 1}>
            다음 →
          </button>
        </div>

        {hasAnyAudio && (
          <div style={{ textAlign: "center", marginTop: 18 }}>
            <button className="read-btn" onClick={() => (playing ? stop() : playFrom(current))}>
              {playing ? "⏹ 그만 읽기" : "▶ 여기부터 읽어주기"}
            </button>
            {!page.hasAudio && (
              <div className="hint" style={{ marginTop: 8 }}>
                이 페이지는 녹음된 소리가 없어요
              </div>
            )}
            {audioFailed && (
              <div className="hint" style={{ marginTop: 8 }}>
                이 기기에서는 목소리 재생이 지원되지 않아요. 그림책은 그대로 넘겨볼 수 있어요.
              </div>
            )}
          </div>
        )}

        <div className="hint" style={{ textAlign: "center", marginTop: 28, lineHeight: 1.8 }}>
          키즈북에서 만든 그림동화예요 💛
          <br />
          이 링크는 {expiry}까지 열려 있어요.
          <br />
          <a href="/">나도 우리 아이 동화책 만들기 →</a>
        </div>
      </section>
    </main>
  );
}
