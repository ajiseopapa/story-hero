"use client";

// 후기 검수 화면 (키는 API에 헤더로만 보낸다 — lib/admin-key 참고. 키 없이는 아무것도 안 보임).
import { useCallback, useEffect, useState } from "react";
import { recallAdminKey } from "@/lib/admin-key";
import { formatDate, type Review } from "@/lib/reviews";
import { updateBadges } from "../shell";

export default function ReviewAdminPage() {
  const [key, setKey] = useState("");
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setKey(recallAdminKey());
  }, []);

  const load = useCallback(async (k: string) => {
    if (!k) return;
    setError(null);
    const res = await fetch("/api/review/admin", { headers: { "x-admin-key": k } });
    if (!res.ok) {
      setError("관리자 키가 올바르지 않아요.");
      setReviews([]);
      return;
    }
    const data = (await res.json()) as { reviews: Review[] };
    setReviews(data.reviews);
    // 검수한 뒤에도 사이드바에 옛 건수가 남지 않게, 여기서 다시 센다.
    updateBadges({ reviews: data.reviews.filter((r) => !r.approved).length });
  }, []);

  useEffect(() => {
    if (key) load(key);
  }, [key, load]);

  const act = async (id: string, action: "approve" | "hide" | "delete") => {
    if (action === "delete" && !confirm("이 후기를 완전히 지울까요?")) return;
    setBusy(id);
    try {
      await fetch("/api/review/admin", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify({ id, action }),
      });
      await load(key);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">후기 검수 🔒</span>
        <h1>남겨진 후기</h1>
        <p>공개를 누른 후기만 첫 화면에 보입니다.</p>
      </header>

      {!key && (
        <section className="card">
          <div className="field">
            <label>관리자 키</label>
            <input
              type="password"
              inputMode="numeric"
              placeholder="관리자 코드 4자리"
              onChange={(e) => setKey(e.target.value.trim())}
            />
          </div>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {reviews && reviews.length === 0 && !error && (
        <section className="card">
          <div className="hint">아직 남겨진 후기가 없어요.</div>
        </section>
      )}

      {reviews?.map((r) => (
        <section className="card" key={r.id}>
          <div className="review-head">
            <span className="review-rate">
              {"★".repeat(r.rating)}
              <i>{"★".repeat(5 - r.rating)}</i>
            </span>
            <span className="review-who">
              {r.nickname}
              {r.bookTitle && <em> · 《 {r.bookTitle} 》</em>}
            </span>
          </div>
          <p style={{ whiteSpace: "pre-wrap", margin: "10px 0" }}>{r.text}</p>
          <div className="hint">
            {formatDate(r.createdAt)} · {r.approved ? "공개 중" : "비공개(검수 대기)"}
          </div>
          <div className="share-actions" style={{ marginTop: 12 }}>
            {r.approved ? (
              <button
                className="btn secondary"
                disabled={busy === r.id}
                onClick={() => act(r.id, "hide")}
              >
                숨기기
              </button>
            ) : (
              <button className="btn" disabled={busy === r.id} onClick={() => act(r.id, "approve")}>
                공개하기
              </button>
            )}
            <button
              className="btn secondary"
              disabled={busy === r.id}
              onClick={() => act(r.id, "delete")}
            >
              삭제
            </button>
          </div>
        </section>
      ))}
    </main>
  );
}
