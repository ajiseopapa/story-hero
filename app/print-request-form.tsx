"use client";

/**
 * 인쇄본 1차 제작 신청 폼.
 * 예전엔 mailto: 링크였는데, 메일 앱이 연결 안 된 기기(대부분의 PC·일부 폰)에서
 * 에러가 나거나 아무 반응이 없어 신청을 놓쳤다 (2026-08-13). 화면 안에서 받아
 * 서버가 관리자에게 메일을 보낸다.
 */
import { useState } from "react";

export default function PrintRequestForm({
  bookTitle,
  onClose,
}: {
  bookTitle: string;
  onClose: () => void;
}) {
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact, message, bookTitle }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "전송에 실패했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      setDone(true);
    } catch {
      setError("전송에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal-card">
        {done ? (
          <>
            <h3 style={{ marginTop: 0 }}>신청이 접수됐어요 📖</h3>
            <p className="hint">
              1차 제작이 확정되면 남겨주신 연락처로 안내드릴게요. 결제는 그때 따로 받아요.
            </p>
            <div className="share-actions">
              <button className="btn" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>인쇄본 1차 제작 신청</h3>
            <p className="hint" style={{ marginTop: 4 }}>
              《 {bookTitle} 》 양장 제본 인쇄본 29,900원 · 지금은 신청만 받고, 제작이 확정되면
              안내드려요.
            </p>
            <div className="field">
              <label>연락 받으실 이메일 또는 전화번호</label>
              <input
                type="text"
                value={contact}
                maxLength={120}
                placeholder="예: mom@example.com / 010-1234-5678"
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
            <div className="field">
              <label>남기실 말 (선택)</label>
              <textarea
                value={message}
                maxLength={1000}
                rows={3}
                placeholder="궁금한 점이나 요청사항이 있으면 적어주세요"
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            {error && <div className="error">{error}</div>}
            <div className="share-actions">
              <button className="btn" onClick={submit} disabled={contact.trim().length < 5 || busy}>
                {busy ? "보내는 중…" : "신청 보내기"}
              </button>
              <button className="btn secondary" onClick={onClose} disabled={busy}>
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
