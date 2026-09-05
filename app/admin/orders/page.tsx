"use client";

// 계좌이체 주문 관리 (후기 검수·퍼널과 같은 키 — API엔 헤더로만 보낸다, lib/admin-key 참고).
// 여기서 "입금 확인"을 누르면 주문자 화면이 자동으로 열린다.
import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/app/confirm-dialog";
import {
  forgetAdminKey,
  recallAdminKey,
  rememberAdminKey,
} from "@/lib/admin-key";
import { AdminKeyInput } from "@/app/admin/key-input";
import { guessChildName } from "@/lib/review-mail";
import { updateBadges } from "../shell";

interface Order {
  id: string;
  name: string;
  email: string;
  amount: number;
  bookTitle: string;
  status: "pending" | "paid" | "canceled";
  createdAt: number;
  paidAt?: number;
  source?: string;
  referrer?: string;
  memo?: string;
  reviewCoupon?: string;
}

/** 후기 요청 메일 만들기 결과 (app/api/order/admin/review-mail) */
interface ReviewMail {
  to: string;
  subject: string;
  body: string;
  coupon: { code: string; expiresAt?: number };
  reused: boolean;
}

/** 유입 한 줄 — 꼬리표(?s=)와 유입 링크 호스트 중 있는 것만 보여준다. */
function entry(o: Order): string {
  const parts = [
    o.source && `꼬리표 ${o.source}`,
    o.referrer && `링크 ${o.referrer}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "직접 방문 (기록 없음)";
}

/** 목록 탭 — 쿠폰으로 열린 0원 주문은 매출과 따로 본다 */
type Tab = "paid" | "pending" | "coupon" | "canceled";
const TAB_LABEL: Record<Tab, string> = {
  paid: "입금 확인",
  pending: "입금 대기",
  coupon: "쿠폰",
  canceled: "취소",
};
function tabOf(o: Order): Tab {
  if (o.status === "canceled") return "canceled";
  if (o.status === "pending") return "pending";
  return o.amount > 0 ? "paid" : "coupon";
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
  /** 고른 탭. 없으면 입금 대기가 있을 때 대기, 아니면 입금 확인 */
  const [tabPick, setTabPick] = useState<Tab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 주문별 메모 입력값. 유입이 저장되기 전 주문의 출처를 손으로 적어두는 칸이라
  // 자동 저장된 유입(위 한 줄)과 섞이지 않게 따로 보여준다.
  const [memoDraft, setMemoDraft] = useState<Record<string, string>>({});
  const [memoSaved, setMemoSaved] = useState<string | null>(null);
  const { confirmDialog, ask } = useConfirm();

  // 후기 요청 메일 창 — 아이 이름·호칭을 채우고 누르면 답례 쿠폰이 생기고 본문이 완성된다.
  const [rv, setRv] = useState<Order | null>(null);
  const [rvChild, setRvChild] = useState("");
  const [rvBusy, setRvBusy] = useState(false);
  const [rvError, setRvError] = useState<string | null>(null);
  const [rvMail, setRvMail] = useState<ReviewMail | null>(null);
  const [rvCopied, setRvCopied] = useState<"subject" | "body" | "code" | null>(
    null,
  );

  useEffect(() => {
    setKey(recallAdminKey());
  }, []);

  const load = useCallback(async (k: string) => {
    if (!k) return;
    setError(null);
    try {
      const res = await fetch("/api/order/admin", {
        headers: { "x-admin-key": k },
      });
      if (!res.ok) {
        setError("관리자 코드가 올바르지 않아요.");
        forgetAdminKey();
        setKey("");
        setOrders([]);
        return;
      }
      rememberAdminKey(k);
      const data = (await res.json()) as { orders: Order[] };
      setOrders(data.orders);
      // 사이드바 뱃지는 여기서 다시 센다 — 개요 화면이 세어둔 값만 믿으면,
      // 이 화면에서 입금 확인·취소를 해도 뱃지에 옛 건수가 남는다.
      updateBadges({
        orders: data.orders.filter((o) => o.status === "pending").length,
      });
    } catch {
      setError("불러오지 못했어요.");
    }
  }, []);

  useEffect(() => {
    if (key) load(key);
  }, [key, load]);

  const act = async (id: string, action: Order["status"] | "delete") => {
    if (
      action === "paid" &&
      !(await ask({
        title: "입금을 확인하셨나요?",
        message: "확인하면 주문자 화면이 바로 열립니다.",
        confirmLabel: "입금 확인",
      }))
    )
      return;
    if (
      action === "delete" &&
      !(await ask({
        title: "주문을 삭제할까요?",
        message: "이 주문이 완전히 지워지고, 되돌릴 수 없어요.",
        confirmLabel: "삭제",
      }))
    )
      return;
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

  /** 메모만 저장한다 — 지금 상태를 그대로 다시 보내므로 입금 확인 메일이 다시 나가지 않는다. */
  const saveMemo = async (o: Order) => {
    setBusy(o.id);
    try {
      await fetch("/api/order/admin", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify({
          id: o.id,
          action: o.status,
          memo: memoDraft[o.id] ?? "",
        }),
      });
      await load(key);
      setMemoSaved(o.id);
      setTimeout(() => setMemoSaved((v) => (v === o.id ? null : v)), 2000);
    } finally {
      setBusy(null);
    }
  };

  const openReview = (o: Order) => {
    setRv(o);
    setRvChild(guessChildName(o.bookTitle));
    setRvError(null);
    setRvMail(null);
    setRvCopied(null);
  };

  const makeReview = async () => {
    if (!rv) return;
    setRvBusy(true);
    setRvError(null);
    try {
      const res = await fetch("/api/order/admin/review-mail", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify({
          id: rv.id,
          childName: rvChild,
        }),
      });
      const data = (await res.json()) as ReviewMail & { error?: string };
      if (!res.ok) {
        setRvError(data.error ?? "만들지 못했어요.");
        return;
      }
      setRvMail(data);
      if (!data.reused) await load(key); // 카드에 쿠폰 코드가 보이게
    } catch {
      setRvError("만들지 못했어요.");
    } finally {
      setRvBusy(false);
    }
  };

  const copyReview = (what: "subject" | "body" | "code") => {
    if (!rvMail) return;
    const text =
      what === "subject"
        ? rvMail.subject
        : what === "body"
          ? rvMail.body
          : rvMail.coupon.code;
    void navigator.clipboard?.writeText(text);
    setRvCopied(what);
    setTimeout(() => setRvCopied((v) => (v === what ? null : v)), 2000);
  };

  const mailtoHref = (m: ReviewMail) =>
    `mailto:${m.to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;

  const paidTotal = (orders ?? [])
    .filter((o) => o.status === "paid")
    .reduce((a, o) => a + o.amount, 0);
  const counts: Record<Tab, number> = {
    paid: 0,
    pending: 0,
    coupon: 0,
    canceled: 0,
  };
  for (const o of orders ?? []) counts[tabOf(o)]++;
  const tab: Tab = tabPick ?? (counts.pending > 0 ? "pending" : "paid");
  const tabs: Tab[] = [
    "paid",
    "pending",
    "coupon",
    ...(counts.canceled ? (["canceled"] as Tab[]) : []),
  ];
  const shown = (orders ?? []).filter((o) => tabOf(o) === tab);

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">주문 관리 🔒</span>
        <h1>계좌이체 주문</h1>
        <p>
          입금을 확인하고 [입금 확인]을 누르면 주문자 화면이 자동으로 열립니다.
        </p>
      </header>

      {!key && (
        <section className="card">
          <div className="field">
            <label>관리자 코드</label>
            <AdminKeyInput onSubmit={setKey} />
          </div>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {orders && (
        <section className="card">
          <div
            className="adm-toolbar"
            style={{ justifyContent: "space-between" }}
          >
            <div className="adm-seg">
              {tabs.map((t) => (
                <button
                  key={t}
                  className={tab === t ? "on" : ""}
                  onClick={() => setTabPick(t)}
                >
                  {TAB_LABEL[t]} {counts[t]}
                </button>
              ))}
            </div>
            <span className="hint">
              확인된 매출 <b>{paidTotal.toLocaleString()}원</b>
            </span>
          </div>
        </section>
      )}

      {orders && shown.length === 0 && !error && (
        <section className="card">
          <div className="hint">
            {orders.length === 0
              ? "아직 주문이 없어요."
              : `${TAB_LABEL[tab]} 주문이 없어요.`}
          </div>
        </section>
      )}

      {shown.map((o) => (
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
          <div className="hint" style={{ marginTop: 4 }}>
            유입 {entry(o)}
            {o.reviewCoupon && (
              <>
                {" · 후기 답례 쿠폰 "}
                <b className="mono">{o.reviewCoupon}</b>
              </>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 8,
              alignItems: "center",
            }}
          >
            <input
              style={{ flex: 1, minWidth: 0 }}
              placeholder="메모 (예: 인스타 릴스 추정, 지인 소개)"
              value={memoDraft[o.id] ?? o.memo ?? ""}
              onChange={(e) =>
                setMemoDraft((m) => ({ ...m, [o.id]: e.target.value }))
              }
            />
            <button
              className="btn secondary"
              disabled={
                busy === o.id ||
                (memoDraft[o.id] ?? o.memo ?? "") === (o.memo ?? "")
              }
              onClick={() => saveMemo(o)}
            >
              {memoSaved === o.id ? "저장됨" : "메모 저장"}
            </button>
          </div>

          <div className="share-actions" style={{ marginTop: 12 }}>
            {o.status === "paid" && (
              <button
                className="btn"
                disabled={busy === o.id}
                onClick={() => openReview(o)}
              >
                {o.reviewCoupon ? "후기 요청 메일 다시 보기" : "후기 요청 메일"}
              </button>
            )}
            {o.status !== "paid" && (
              <button
                className="btn"
                disabled={busy === o.id}
                onClick={() => act(o.id, "paid")}
              >
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

      {rv && (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="modal-card adm rv-card">
            <h3 style={{ marginTop: 0 }}>후기 요청 메일</h3>
            <p className="hint" style={{ marginTop: 4 }}>
              {rv.name}
              {rv.email && (
                <>
                  {" · "}
                  <span style={{ wordBreak: "break-all" }}>{rv.email}</span>
                </>
              )}
              {rv.bookTitle && <> · 《 {rv.bookTitle} 》</>}
            </p>

            {!rvMail ? (
              <>
                <div className="adm-form">
                  <div className="field">
                    <label>아이 이름</label>
                    <input
                      type="text"
                      value={rvChild}
                      maxLength={20}
                      placeholder="책 제목에서 짐작한 이름 · 틀리면 고쳐주세요"
                      onChange={(e) => setRvChild(e.target.value)}
                    />
                  </div>
                </div>
                <p className="hint">
                  {rv.reviewCoupon ? (
                    <>
                      이 주문에 묶인 답례 쿠폰{" "}
                      <b className="mono">{rv.reviewCoupon}</b>을 그대로 씁니다.
                    </>
                  ) : (
                    <>
                      누르면 답례 쿠폰(1회 · 30일)이 새로 발급되고 메일 본문에
                      들어갑니다.
                    </>
                  )}
                </p>
                {rvError && <div className="error">{rvError}</div>}
                <div className="share-actions">
                  <button
                    className="btn"
                    onClick={makeReview}
                    disabled={rvBusy || !rvChild.trim()}
                  >
                    {rvBusy ? "만드는 중…" : "쿠폰 만들고 메일 완성"}
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => setRv(null)}
                    disabled={rvBusy}
                  >
                    닫기
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rv-coupon">
                  <span className="hint">
                    답례 쿠폰{rvMail.reused ? " (기존)" : " 발급됨"}
                  </span>
                  <b className="mono">{rvMail.coupon.code}</b>
                  <button
                    className="btn secondary small"
                    onClick={() => copyReview("code")}
                  >
                    {rvCopied === "code" ? "복사됨 ✓" : "복사"}
                  </button>
                </div>
                <div className="field">
                  <label>제목</label>
                  <div className="rv-row">
                    <input
                      type="text"
                      readOnly
                      value={rvMail.subject}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      className="btn secondary small"
                      onClick={() => copyReview("subject")}
                    >
                      {rvCopied === "subject" ? "복사됨 ✓" : "복사"}
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label>본문</label>
                  <textarea
                    className="rv-body"
                    readOnly
                    value={rvMail.body}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div className="share-actions">
                  <button className="btn" onClick={() => copyReview("body")}>
                    {rvCopied === "body" ? "본문 복사됨 ✓" : "본문 복사"}
                  </button>
                  <a className="btn secondary" href={mailtoHref(rvMail)}>
                    메일 앱으로 열기
                  </a>
                  <button className="btn secondary" onClick={() => setRv(null)}>
                    닫기
                  </button>
                </div>
                <p className="hint" style={{ marginBottom: 0 }}>
                  {rvMail.to ? (
                    <>
                      보내는 주소는 <b>{rvMail.to}</b> · 발신은
                      support@kidstel.co.kr 로 맞춰주세요.
                    </>
                  ) : (
                    <>
                      이 주문엔 이메일이 없어요. 발신은 support@kidstel.co.kr 로
                      맞춰주세요.
                    </>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {confirmDialog}
    </main>
  );
}
