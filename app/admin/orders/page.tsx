"use client";

// 계좌이체 주문 관리 (후기 검수·퍼널과 같은 키 — API엔 헤더로만 보낸다, lib/admin-key 참고).
// 여기서 "입금 확인"을 누르면 주문자 화면이 자동으로 열린다.
import { useCallback, useEffect, useState } from "react";
import { recallAdminKey, rememberAdminKey } from "@/lib/admin-key";

interface Order {
  id: string;
  name: string;
  email: string;
  amount: number;
  bookTitle: string;
  status: "pending" | "paid" | "canceled";
  createdAt: number;
  paidAt?: number;
}

const STATUS_LABEL: Record<Order["status"], string> = {
  pending: "입금 대기",
  paid: "입금 확인됨",
  canceled: "취소",
};

function when(ms: number): string {
  if (!ms) return "-";
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export default function OrderAdminPage() {
  const [key, setKey] = useState("");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setKey(recallAdminKey());
  }, []);

  const load = useCallback(async (k: string) => {
    if (!k) return;
    setError(null);
    try {
      const res = await fetch("/api/order/admin", { headers: { "x-admin-key": k } });
      if (!res.ok) {
        setError("관리자 키가 올바르지 않아요.");
        setOrders([]);
        return;
      }
      rememberAdminKey(k);
      const data = (await res.json()) as { orders: Order[] };
      setOrders(data.orders);
    } catch {
      setError("불러오지 못했어요.");
    }
  }, []);

  useEffect(() => {
    if (key) load(key);
  }, [key, load]);

  const act = async (id: string, action: Order["status"] | "delete") => {
    if (action === "paid" && !confirm("입금을 확인하셨나요? 주문자 화면이 바로 열립니다.")) return;
    if (action === "delete" && !confirm("이 주문을 완전히 삭제할까요? 되돌릴 수 없어요.")) return;
    setBusy(id);
    try {
      await fetch("/api/order/admin", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify({ id, action }),
      });
      await load(key);
    } finally {
      setBusy(null);
    }
  };

  const pending = orders?.filter((o) => o.status === "pending") ?? [];
  const paidTotal = (orders ?? [])
    .filter((o) => o.status === "paid")
    .reduce((a, o) => a + o.amount, 0);

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">주문 관리 🔒</span>
        <h1>계좌이체 주문</h1>
        <p>입금을 확인하고 [입금 확인]을 누르면 주문자 화면이 자동으로 열립니다.</p>
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

      {orders && (
        <section className="card">
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div>
              <div className="hint">입금 대기</div>
              <b style={{ fontSize: "1.4rem" }}>{pending.length}건</b>
            </div>
            <div>
              <div className="hint">입금 확인됨</div>
              <b style={{ fontSize: "1.4rem" }}>
                {orders.filter((o) => o.status === "paid").length}건
              </b>
            </div>
            <div>
              <div className="hint">확인된 매출</div>
              <b style={{ fontSize: "1.4rem" }}>{paidTotal.toLocaleString()}원</b>
            </div>
          </div>
        </section>
      )}

      {orders && orders.length === 0 && !error && (
        <section className="card">
          <div className="hint">아직 주문이 없어요.</div>
        </section>
      )}

      {orders?.map((o) => (
        <section className="card" key={o.id}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "baseline",
            }}
          >
            <b style={{ fontSize: "1.05rem" }}>
              {o.name}
              <span className="hint" style={{ marginLeft: 8 }}>
                {o.amount.toLocaleString()}원
              </span>
            </b>
            <span className="hint">
              {STATUS_LABEL[o.status]} · 주문 {when(o.createdAt)}
              {o.paidAt ? ` · 확인 ${when(o.paidAt)}` : ""}
            </span>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            주문번호 <b>{o.id.slice(0, 8).toUpperCase()}</b>
            {o.bookTitle && <> · 《 {o.bookTitle} 》</>}
          </div>
          <div style={{ marginTop: 4, wordBreak: "break-all" }}>
            <a href={`mailto:${o.email}`}>{o.email}</a>
          </div>

          <div className="share-actions" style={{ marginTop: 12 }}>
            {o.status !== "paid" && (
              <button className="btn" disabled={busy === o.id} onClick={() => act(o.id, "paid")}>
                입금 확인
              </button>
            )}
            {o.status === "pending" && (
              <button
                className="btn secondary"
                disabled={busy === o.id}
                onClick={() => act(o.id, "canceled")}
              >
                취소 처리
              </button>
            )}
            {o.status !== "pending" && (
              <button
                className="btn secondary"
                disabled={busy === o.id}
                onClick={() => act(o.id, "pending")}
              >
                대기로 되돌리기
              </button>
            )}
            <button
              className="btn secondary"
              disabled={busy === o.id}
              onClick={() => act(o.id, "delete")}
            >
              삭제
            </button>
          </div>
        </section>
      ))}
    </main>
  );
}
