"use client";

// 무료 쿠폰 발급·관리. 쿠폰을 쓰면 0원짜리 '입금 확인된 주문'이 생긴다(lib/coupons.ts).
import { useCallback, useEffect, useState } from "react";
import { recallAdminKey } from "@/lib/admin-key";
import { useConfirm } from "@/app/confirm-dialog";

interface Coupon {
  code: string;
  maxUses: number;
  used: number;
  memo?: string;
  expiresAt?: number;
  createdAt: number;
}

function day(ms?: number): string {
  if (!ms) return "";
  const t = new Date(ms + 9 * 60 * 60 * 1000).toISOString();
  return t.slice(0, 10);
}

export default function CouponAdminPage() {
  const [key, setKey] = useState("");
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const { confirmDialog, ask } = useConfirm();

  // 수정 창 — 횟수·메모·만료일만 고친다. 코드·사용 횟수는 못 바꾼다.
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [eMaxUses, setEMaxUses] = useState(1);
  const [eMemo, setEMemo] = useState("");
  const [eExpiresOn, setEExpiresOn] = useState("");
  const [eError, setEError] = useState<string | null>(null);

  // 발급 폼
  const [code, setCode] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState("");

  useEffect(() => setKey(recallAdminKey()), []);

  const load = useCallback(async (k: string) => {
    if (!k) return;
    setError(null);
    try {
      const res = await fetch("/api/coupon/admin", { headers: { "x-admin-key": k } });
      if (!res.ok) {
        setError("관리자 키가 올바르지 않아요.");
        return;
      }
      const data = (await res.json()) as { coupons: Coupon[] };
      setCoupons(data.coupons);
    } catch {
      setError("불러오지 못했어요.");
    }
  }, []);

  useEffect(() => {
    if (key) void load(key);
  }, [key, load]);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/coupon/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": key },
        body: JSON.stringify({ code: code || undefined, maxUses, memo, days: Number(days) || 0 }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "발급하지 못했어요.");
        return;
      }
      setCode("");
      setMemo("");
      setDays("");
      setMaxUses(1);
      await load(key);
    } catch {
      setError("발급하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (c: Coupon) => {
    setEditing(c);
    setEMaxUses(c.maxUses);
    setEMemo(c.memo ?? "");
    setEExpiresOn(c.expiresAt ? day(c.expiresAt) : "");
    setEError(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setEError(null);
    try {
      const res = await fetch("/api/coupon/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": key },
        body: JSON.stringify({
          code: editing.code,
          maxUses: eMaxUses,
          memo: eMemo,
          expiresOn: eExpiresOn,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEError(data.error ?? "저장하지 못했어요.");
        return;
      }
      setEditing(null);
      await load(key);
    } catch {
      setEError("저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: string) => {
    if (
      !(await ask({
        title: "쿠폰을 삭제할까요?",
        message: `${c} 코드가 지워지고, 되돌릴 수 없어요.\n기간만 늘리려면 삭제 말고 수정을 쓰세요.`,
        confirmLabel: "삭제",
      }))
    )
      return;
    setBusy(true);
    try {
      await fetch(`/api/coupon/admin?code=${encodeURIComponent(c)}`, {
        method: "DELETE",
        headers: { "x-admin-key": key },
      });
      await load(key);
    } finally {
      setBusy(false);
    }
  };

  const copy = (c: string) => {
    void navigator.clipboard?.writeText(c);
    setCopied(c);
    setTimeout(() => setCopied(""), 2000);
  };

  const total = coupons?.length ?? 0;
  const live =
    coupons?.filter((c) => c.used < c.maxUses && !(c.expiresAt && c.expiresAt < Date.now()))
      .length ?? 0;
  const usedSum = coupons?.reduce((a, c) => a + c.used, 0) ?? 0;

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">무료 쿠폰</span>
        <h1>공짜로 열어주기</h1>
        <p>지인·체험단에게 줄 코드를 만듭니다. 쓰면 그 책 한 권이 결제한 것처럼 전부 열려요.</p>
      </header>

      {!key && (
        <section className="card">
          <div className="field">
            <label>관리자 키</label>
            <input
              type="password"
              placeholder="관리자 키를 입력하세요"
              onChange={(e) => setKey(e.target.value.trim())}
            />
          </div>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {key && (
        <>
          <section className="card">
            <div className="adm-cardhead">
              <div>
                <h2>쿠폰 만들기</h2>
                <div className="hint">코드는 비워두면 KIDS로 시작하는 코드를 자동으로 지어요.</div>
              </div>
            </div>

            {/* 짧은 값(횟수·기간)은 좁은 칸에 단위와 함께 — 네 칸이 세로로 늘어서면 폼이 길어 보인다 */}
            <div className="adm-form">
              <div className="field">
                <label>코드</label>
                <input
                  type="text"
                  className="mono"
                  value={code}
                  placeholder="비우면 자동 · 예: KIDSTEL2026"
                  maxLength={20}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </div>
              <div className="field">
                <label>사용 횟수</label>
                <div className="adm-unit">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={maxUses}
                    onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
                  />
                  <span>번</span>
                </div>
              </div>
              <div className="field">
                <label>메모</label>
                <input
                  type="text"
                  value={memo}
                  maxLength={60}
                  placeholder="누구에게 줬는지 · 예: 유치원 학부모 체험단"
                  onChange={(e) => setMemo(e.target.value)}
                />
              </div>
              <div className="field">
                <label>유효기간</label>
                <div className="adm-unit">
                  <input
                    type="number"
                    min={1}
                    value={days}
                    placeholder="무기한"
                    onChange={(e) => setDays(e.target.value)}
                  />
                  <span>일</span>
                </div>
              </div>
            </div>

            <div className="adm-formfoot">
              <button className="btn" onClick={issue} disabled={busy}>
                {busy ? "만드는 중…" : "쿠폰 만들기"}
              </button>
              <span className="hint">
                {maxUses}번 쓸 수 있는 쿠폰 · {Number(days) > 0 ? days + "일 뒤 만료" : "무기한"}
              </span>
            </div>
          </section>

          <section className="card">
            <div className="adm-cardhead">
              <h2>발급한 쿠폰</h2>
              {coupons && coupons.length > 0 && (
                <div className="adm-sum">
                  <span>
                    살아 있음 <b>{live}</b>
                  </span>
                  <span>
                    총 <b>{total}</b>장
                  </span>
                  <span>
                    쓰인 횟수 <b>{usedSum}</b>
                  </span>
                </div>
              )}
            </div>

            {coupons === null ? (
              <div className="adm-empty">불러오는 중…</div>
            ) : coupons.length === 0 ? (
              <div className="adm-empty">아직 만든 쿠폰이 없어요. 위에서 첫 쿠폰을 만들어보세요.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>코드</th>
                      <th className="num">사용</th>
                      <th>메모</th>
                      <th>만료</th>
                      <th>상태</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.map((c) => {
                      const done = c.used >= c.maxUses;
                      const expired = !!c.expiresAt && c.expiresAt < Date.now();
                      const dim = done || expired;
                      return (
                        <tr key={c.code} className={dim ? "dim" : undefined}>
                          <td>
                            <button
                              type="button"
                              className="adm-code"
                              title="누르면 복사"
                              onClick={() => copy(c.code)}
                            >
                              {c.code}
                            </button>
                          </td>
                          <td className="num">
                            <span className="adm-use">
                              <b>{c.used}</b> / {c.maxUses}
                            </span>
                            <i className="adm-usebar" aria-hidden="true">
                              <i style={{ width: Math.min(100, (c.used / c.maxUses) * 100) + "%" }} />
                            </i>
                          </td>
                          <td className="memo">{c.memo ?? <span className="none">—</span>}</td>
                          <td className="date">{c.expiresAt ? day(c.expiresAt) : "무기한"}</td>
                          <td>
                            {expired ? (
                              <span className="adm-pill canceled">만료</span>
                            ) : done ? (
                              <span className="adm-pill muted">다 씀</span>
                            ) : (
                              <span className="adm-pill paid">남음</span>
                            )}
                          </td>
                          <td className="acts">
                            <button className="btn secondary small" onClick={() => copy(c.code)}>
                              {copied === c.code ? "복사됨 ✓" : "복사"}
                            </button>
                            <button
                              className="btn secondary small"
                              onClick={() => openEdit(c)}
                              disabled={busy}
                            >
                              수정
                            </button>
                            <button
                              className="btn secondary small danger"
                              onClick={() => remove(c.code)}
                              disabled={busy}
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="hint" style={{ marginTop: 12 }}>
              쿠폰을 쓰면 <b>0원짜리 주문</b>이 하나 생겨 주문 목록에 남습니다. 매출 계산에는
              섞이지 않아요(금액 0원).
            </div>
          </section>
        </>
      )}

      {editing && (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="modal-card adm">
            <h3 style={{ marginTop: 0 }}>
              <span className="mono">{editing.code}</span> 고치기
            </h3>
            <p className="hint" style={{ marginTop: 4 }}>
              지금까지 <b>{editing.used}</b>번 쓰였어요. 횟수를 그보다 적게 잡으면 바로 &ldquo;다
              씀&rdquo;이 돼요.
            </p>
            <div className="field">
              <label>사용 횟수</label>
              <div className="adm-unit">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={eMaxUses}
                  onChange={(e) => setEMaxUses(Number(e.target.value) || 1)}
                />
                <span>번</span>
              </div>
            </div>
            <div className="field">
              <label>메모</label>
              <input
                type="text"
                value={eMemo}
                maxLength={60}
                placeholder="비우면 메모 없음"
                onChange={(e) => setEMemo(e.target.value)}
              />
            </div>
            <div className="field">
              <label>만료일</label>
              <div className="adm-date">
                <input
                  type="date"
                  value={eExpiresOn}
                  onChange={(e) => setEExpiresOn(e.target.value)}
                />
                {eExpiresOn ? (
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => setEExpiresOn("")}
                  >
                    무기한으로
                  </button>
                ) : (
                  <span>무기한</span>
                )}
              </div>
              <div className="hint">그날 밤 12시(한국시간)까지 쓸 수 있어요.</div>
            </div>
            {eError && <div className="error">{eError}</div>}
            <div className="share-actions">
              <button className="btn" onClick={saveEdit} disabled={busy}>
                {busy ? "저장 중…" : "저장"}
              </button>
              <button
                className="btn secondary"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </main>
  );
}
