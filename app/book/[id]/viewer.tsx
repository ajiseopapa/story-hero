"use client";

// 공유 링크로 열리는 웹 스토리북 뷰어 — 그림 넘기기 + 이어읽기.
// 삽화·음성은 /api/book/{id}/{파일}로 하나씩 받아온다(비공개 블롭 경유).
import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_ORIGIN, type SharePage } from "@/lib/sharebook";
import { drawShareCard } from "@/lib/share-card";
import { trackEvery, trackStep } from "@/lib/track";

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

  // 공유 책이 바이럴 루프로 일하는지 본다 — 열람이 잡혀야 재공유·새 방문 전환율이 나온다
  useEffect(() => {
    trackStep("book:view");
  }, []);

  const go = (n: number) => {
    stop();
    setCurrent(Math.max(0, Math.min(total - 1, n)));
  };

  const hasAnyAudio = pages.some((p) => p.hasAudio);

  // ----- 다시 공유하기 — 받은 사람이 또 퍼뜨릴 수 있어야 루프가 돈다 -----
  const shareUrl = `${SITE_ORIGIN}/book/${id}`;
  const [copied, setCopied] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardMsg, setCardMsg] = useState("");

  const shareLink = async () => {
    const data = {
      title: `《 ${title} 》`,
      text: "우리 아이가 주인공인 그림동화예요 💛",
      url: shareUrl,
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        trackEvery("book:share");
      } catch {
        // 공유 시트를 닫은 것 — 센다면 허수다
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      trackEvery("book:share");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // 클립보드가 막힌 브라우저 — 주소창 복사로도 충분해서 안내하지 않는다
    }
  };

  const saveCard = async () => {
    if (cardBusy) return;
    setCardBusy(true);
    setCardMsg("");
    try {
      const blob = await drawShareCard(imgSrc(0), title);
      const file = new File([blob], "kidsbook.png", { type: "image/png" });
      // 모바일이면 공유 시트로 바로 인스타에 보낼 수 있게 한다
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `《 ${title} 》` });
          trackEvery("book:card");
          return;
        } catch {
          return; // 시트를 닫은 것 — 파일까지 내려받게 하면 성가시다
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "우리아이동화책.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      trackEvery("book:card");
      setCardMsg("카드를 저장했어요 — 인스타에 올려 자랑해 주세요 💛");
    } catch {
      setCardMsg("카드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setCardBusy(false);
    }
  };

  return (
    <main className="wrap">
      <section className="book">
        {/* 받은 사람이 어느 페이지에서든 키즈북 홈으로 갈 수 있는 자리 */}
        <a className="book-brand" href="/?s=book">
          키즈북 ✨
        </a>
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

        <div className="share-actions book-share">
          <button className="btn share" onClick={shareLink}>
            📤 이 동화책 공유하기
          </button>
          {copied && <div className="hint">링크를 복사했어요 — 붙여넣기만 하면 돼요!</div>}
          {pages[0]?.hasImage && (
            <button className="btn secondary" onClick={saveCard} disabled={cardBusy}>
              {cardBusy ? "카드를 만드는 중…" : "🖼️ 인스타 자랑 카드 저장"}
            </button>
          )}
          {cardMsg && <div className="hint">{cardMsg}</div>}
        </div>

        {/* ?s=book — 공유 책을 보고 넘어온 방문을 퍼널에서 따로 센다 */}
        <div className="book-outro">
          <a className="btn" href="/?s=book">
            🪄 나도 우리 아이 동화책 만들기
          </a>
          <div className="hint">
            키즈북에서 만든 그림동화예요 💛
            <br />이 링크는 {expiry}까지 열려 있어요.
          </div>
        </div>
      </section>
    </main>
  );
}
