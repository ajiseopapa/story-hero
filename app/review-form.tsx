"use client";

// 책을 다 받은 뒤 남기는 후기. 제출하면 검수를 거쳐 공개된다.
import { useState } from "react";
import { MAX_NICKNAME, MAX_TEXT } from "@/lib/reviews";

type Props = {
  bookTitle: string;
  onDone: () => void;
};

export default function ReviewForm({ bookTitle, onDone }: Props) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState("");
  const [nickname, setNickname] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, text, nickname, bookTitle }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "후기를 남기지 못했어요.");
      setDone(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "후기를 남기지 못했어요.");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="review-box done">
        <div className="review-emoji">💌</div>
        <div className="review-title">후기 고맙습니다!</div>
        <div className="hint">
          확인 후 사이트에 올려드릴게요. 다른 부모님들께 큰 도움이 됩니다.
        </div>
      </div>
    );
  }

  return (
    <div className="review-box">
      <div className="review-emoji">⭐</div>
      <div className="review-title">아이는 어떤 반응이었나요?</div>
      <div className="hint" style={{ marginBottom: 12 }}>
        짧은 후기가 다른 부모님께 큰 도움이 됩니다. 아이 실명은 적지 말아주세요.
      </div>

      <div
        className="review-stars"
        onMouseLeave={() => setHover(0)}
        role="radiogroup"
        aria-label="별점"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n}점`}
            className={(hover || rating) >= n ? "on" : ""}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        className="review-text"
        rows={3}
        maxLength={MAX_TEXT}
        placeholder="예: 아이가 자기 얼굴을 보고 소리를 질렀어요. 매일 밤 이 책만 읽어달라고 해요."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="review-count">
        {text.length} / {MAX_TEXT}
      </div>

      <input
        type="text"
        maxLength={MAX_NICKNAME}
        placeholder="표시할 별명 (예: 6세 딸 엄마)"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
      />

      {error && <div className="error">{error}</div>}

      <button
        className="btn"
        style={{ marginTop: 12 }}
        disabled={sending || rating === 0 || text.trim().length < 5}
        onClick={submit}
      >
        {sending ? "보내는 중…" : "후기 남기기 💌"}
      </button>
    </div>
  );
}
