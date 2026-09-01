"use client";

// 무료 쿠폰 발급·관리. 쿠폰을 쓰면 0원짜리 '입금 확인된 주문'이 생긴다(lib/coupons.ts).
import { useCallback, useEffect, useState } from "react";
import { recallAdminKey } from "@/lib/admin-key";

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

  const remove = async (c: string) => {
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

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">무료 쿠폰 🔒</span>
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
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>쿠폰 만들기</h2>
            <div className="field">
              <label>코드 (비우면 자동으로 지어드려요)</label>
              <input
                type="text"
                value={code}
                placeholder="예: KIDSTEL2026"
                maxLength={20}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="field">
              <label>몇 번 쓸 수 있나</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
              />
            </div>
            <div className="field">
              <label>메모 (누구에게 줬는지)</label>
              <input
                type="text"
                value={memo}
                maxLength={60}
                placeholder="예: 유치원 학부모 체험단"
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
            <div className="field">
              <label>유효기간 (일 단위, 비우면 무기한)</label>
              <input
                type="number"
                min={1}
                value={days}
                placeholder="예: 30"
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <button className="btn" onClick={issue} disabled={busy}>
              {busy ? "만드는 중…" : "쿠폰 만들기"}
            </button>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>발급한 쿠폰</h2>
            {coupons === null ? (
              <div className="hint">불러오는 중…</div>
            ) : coupons.length === 0 ? (
              <div className="hint">아직 만든 쿠폰이 없어요.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: ".9rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>코드</th>
                      <th style={{ textAlign: "right", padding: "6px 8px" }}>사용</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>메모</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>만료</th>
                      <th style={{ padding: "6px 8px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.map((c) => {
                      const done = c.used >= c.maxUses;
                      const expired = !!c.expiresAt && c.expiresAt < Date.now();
                      return (
                        <tr key={c.code} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            <b
                              style={{
                                fontFamily: "monospace",
                                opacity: done || expired ? 0.45 : 1,
                              }}
                            >
                              {c.code}
                            </b>
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              padding: "6px 8px",
                              fontVariantNumeric: "tabular-nums",
                              color: done ? "#dc2626" : undefined,
                            }}
                          >
                            {c.used} / {c.maxUses}
                          </td>
                          <td style={{ padding: "6px 8px" }}>{c.memo ?? ""}</td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            {c.expiresAt ? `${day(c.expiresAt)}${expired ? " (지남)" : ""}` : "무기한"}
                          </td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            <button className="btn secondary small" onClick={() => copy(c.code)}>
                              {copied === c.code ? "복사됨 ✓" : "복사"}
                            </button>{" "}
                            <button
                              className="btn secondary small"
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
            <div className="hint" style={{ marginTop: 10 }}>
              쿠폰을 쓰면 <b>0원짜리 주문</b>이 하나 생겨 주문 목록에 남습니다. 매출 계산에는
              섞이지 않아요(금액 0원).
            </div>
          </section>
        </>
      )}
    </main>
  );
}
