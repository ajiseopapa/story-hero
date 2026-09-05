"use client";

/**
 * 계좌이체 주문 화면.
 *
 * 카드 결제를 열기 전 검증 기간용. 사려는 사람의 이름·이메일을 받아두고,
 * 관리자가 입금을 확인해 상태를 바꾸면 이 화면이 그걸 감지해 책을 열어준다.
 *
 * ⭐ 책은 서버에 올라가 있지 않다. 사용자 브라우저(IndexedDB)에만 있고,
 *    여기서 주고받는 건 "이 주문이 입금 확인됐나" 여부뿐이다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { kvDel, kvGet, kvSet } from "@/lib/store";
import { BUSINESS } from "@/lib/business";
import { metaTrack, META_PRICE } from "@/lib/meta-pixel";
import { entrySource } from "@/lib/track";
import { PAY_DEADLINE_DAYS, payDeadline } from "@/lib/order-terms";

const BANK_ACCOUNT = process.env.NEXT_PUBLIC_BANK_ACCOUNT ?? "";

export type BankOrder = { id: string; token: string; orderNo: string; at: number };

const STORE_KEY = "bankOrder";

export async function loadBankOrder(): Promise<BankOrder | null> {
  return (await kvGet<BankOrder>(STORE_KEY)) ?? null;
}

export async function clearBankOrder(): Promise<void> {
  await kvDel(STORE_KEY);
}

export type BankOrderStatus = "pending" | "paid" | "canceled" | "unknown";

/** 저장된 주문의 상태를 물어본다. 네트워크 실패·없는 주문은 "unknown"(조용히 넘긴다). */
export async function fetchBankOrderStatus(order: BankOrder): Promise<BankOrderStatus> {
  try {
    const res = await fetch(
      `/api/order/status?id=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.token)}`,
    );
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { status?: string };
    return data.status === "paid" || data.status === "canceled" ? data.status : "pending";
  } catch {
    return "unknown";
  }
}

/** 저장된 주문의 입금 확인 여부 */
export async function checkBankOrderPaid(order: BankOrder): Promise<boolean> {
  return (await fetchBankOrderStatus(order)) === "paid";
}

/** "9월 8일 오후 2시" */
function deadlineText(createdAt: number): string {
  const d = new Date(payDeadline(createdAt));
  const h = d.getHours();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}시`;
}

export default function BankOrderBox({
  bookTitle,
  price,
  initialCoupon = "",
  onPaid,
  onClose,
}: {
  bookTitle: string;
  price: number;
  /** 샘플 단계에서 미리 적어둔 쿠폰 코드 — 여기서 다시 적지 않게 채워 둔다 */
  initialCoupon?: string;
  onPaid: (order: BankOrder) => void; // 주문 id+token을 넘겨야 서버가 "돈 낸 주문"으로 검증한다
  onClose: () => void;
}) {
  const [order, setOrder] = useState<BankOrder | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedNote, setCheckedNote] = useState<string | null>(null);
  // 입금 기한이 지나 서버가 취소한 주문 — 다시 주문하도록 안내한다
  const [expired, setExpired] = useState(false);
  const [copied, setCopied] = useState(false);
  const [coupon, setCoupon] = useState(initialCoupon.toUpperCase());
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 30초 자동 확인과 수동 확인 버튼이 동시에 입금을 감지해도 onPaid는 한 번만 부른다
  // (두 번 부르면 남은 장면 생성이 두 벌 돌아 비용이 2배로 나간다)
  const paidNotifiedRef = useRef(false);

  // 이미 접수한 주문이 있으면 그 화면부터 보여준다
  useEffect(() => {
    loadBankOrder().then((saved) => saved && setOrder(saved));
  }, []);

  const verify = useCallback(
    async (o: BankOrder, manual: boolean) => {
      if (manual) {
        setChecking(true);
        setCheckedNote(null);
      }
      const status = await fetchBankOrderStatus(o);
      if (manual) setChecking(false);
      if (status === "paid") {
        if (paidNotifiedRef.current) return;
        paidNotifiedRef.current = true;
        onPaid(o);
      } else if (status === "canceled") {
        // 기한이 지나 취소된 주문은 잊는다 — 남겨두면 "대기 중"이 영원히 뜬다
        setExpired(true);
        await clearBankOrder();
        if (timerRef.current) clearInterval(timerRef.current);
      } else if (manual) {
        setCheckedNote("아직 입금 확인 전이에요. 확인되면 이메일로 알려드릴게요.");
      }
    },
    [onPaid],
  );

  // 접수 후에는 30초마다 조용히 확인한다 — 창을 열어둔 채 입금하는 사람이 많다
  useEffect(() => {
    if (!order) return;
    void verify(order, false);
    timerRef.current = setInterval(() => void verify(order, false), 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [order, verify]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 유입 정보(꼬리표·유입 호스트)도 함께 — 어느 링크가 실제 주문까지 왔는지 보려고
        body: JSON.stringify({ name, email, bookTitle, ...entrySource() }),
      });
      const data = (await res.json()) as {
        id?: string;
        token?: string;
        orderNo?: string;
        error?: string;
      };
      if (!res.ok || !data.id || !data.token || !data.orderNo) {
        setError(data.error ?? "주문을 접수하지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      const saved: BankOrder = {
        id: data.id,
        token: data.token,
        orderNo: data.orderNo,
        at: Date.now(),
      };
      await kvSet(STORE_KEY, saved);
      setOrder(saved);
      // 계좌이체 기간의 최종 전환 신호. 입금은 나중에 수동 확인되지만 그 순간을 잡을
      // 클라이언트가 없으므로, 주문 접수를 구매로 본다(착오 주문은 광고 학습에 묻힐 만큼 적다).
      metaTrack("Purchase", { value: META_PRICE, currency: "KRW" });
    } catch {
      setError("연결에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 무료 쿠폰 쓰기. 서버가 0원짜리 '입금 확인된 주문'을 만들어주므로,
   * 그 뒤는 입금이 확인된 경우와 완전히 같은 길을 탄다.
   */
  const useCoupon = async () => {
    setCouponBusy(true);
    setCouponError(null);
    try {
      const res = await fetch("/api/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 쿠폰도 이름·이메일을 받는다 — 누가 썼는지 남기고, 안내 메일을 보낼 수 있어야 한다
        body: JSON.stringify({ code: coupon, bookTitle, name, email }),
      });
      const data = (await res.json()) as {
        id?: string;
        token?: string;
        orderNo?: string;
        error?: string;
      };
      if (!res.ok || !data.id || !data.token || !data.orderNo) {
        setCouponError(data.error ?? "쿠폰을 쓰지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      if (paidNotifiedRef.current) return; // 입금 확인과 동시에 눌려도 한 번만
      paidNotifiedRef.current = true;
      onPaid({ id: data.id, token: data.token, orderNo: data.orderNo, at: Date.now() });
    } catch {
      setCouponError("연결에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setCouponBusy(false);
    }
  };

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(BANK_ACCOUNT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드가 막힌 브라우저에서는 그냥 눈으로 보고 옮겨 적으면 된다
    }
  };

  const canSubmit = name.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal-card">
        {!order ? (
          <>
            <h3 style={{ marginTop: 0 }}>계좌이체로 주문하기</h3>
            <p className="hint" style={{ marginTop: 4 }}>
              카드 결제는 준비 중이라, 지금은 계좌이체로만 받고 있어요. 입금이 확인되면 나머지
              장면과 PDF·소리책이 모두 열립니다.
            </p>

            <div className="order-amount">
              <span>《 {bookTitle} 》 전체 보기</span>
              <b>{price.toLocaleString()}원</b>
            </div>

            {BANK_ACCOUNT ? (
              <div className="order-bank">
                <div className="hint">입금 계좌</div>
                <div className="order-bank-row">
                  <b>{BANK_ACCOUNT}</b>
                  <button type="button" className="btn secondary small" onClick={copyAccount}>
                    {copied ? "복사됨 ✓" : "복사"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="hint" style={{ margin: "10px 0" }}>
                입금 계좌를 준비하고 있어요. 아래에 남겨주시면 준비되는 대로 이메일로
                안내드릴게요.
              </div>
            )}

            <div className="field">
              <label>이름</label>
              <input
                type="text"
                value={name}
                maxLength={40}
                placeholder="입금하실 때는 통장에 찍히는 이름으로"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>이메일</label>
              <input
                type="email"
                value={email}
                maxLength={120}
                placeholder="안내를 받으실 이메일 주소"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {error && <div className="error">{error}</div>}

            <div className="share-actions">
              <button className="btn" onClick={submit} disabled={!canSubmit || busy}>
                {busy ? "접수하는 중…" : "주문 접수하기"}
              </button>
              <button className="btn secondary" onClick={onClose} disabled={busy}>
                닫기
              </button>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              이름과 이메일은 입금 확인과 안내에만 씁니다. 자세한 내용은 개인정보처리방침을
              봐주세요.
            </p>

            <div className="coupon-box">
              <div className="field" style={{ marginBottom: 8 }}>
                <label>무료 쿠폰이 있으세요?</label>
                <input
                  type="text"
                  value={coupon}
                  maxLength={20}
                  placeholder="쿠폰 코드를 입력하세요"
                  autoCapitalize="characters"
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                />
              </div>
              {couponError && <div className="error">{couponError}</div>}
              {/* 쿠폰도 위의 이름·이메일이 있어야 쓴다 — 버튼만 죽여두면 왜 안 눌리는지 모른다 */}
              {coupon.trim().length >= 4 && !canSubmit && (
                <div className="hint" style={{ marginBottom: 8 }}>
                  위에 이름과 이메일을 먼저 적어주세요.
                </div>
              )}
              <button
                type="button"
                className="btn secondary"
                onClick={useCoupon}
                disabled={coupon.trim().length < 4 || !canSubmit || couponBusy}
              >
                {couponBusy ? "확인하는 중…" : "쿠폰으로 열기"}
              </button>
            </div>
          </>
        ) : expired ? (
          <>
            <h3 style={{ marginTop: 0 }}>입금 기한이 지나 주문이 취소됐어요</h3>
            <p>
              주문번호 <b>{order.orderNo}</b>는 {PAY_DEADLINE_DAYS}일 안에 입금이 확인되지 않아
              취소됐어요. 만들어 두신 동화는 그대로 있으니 다시 주문하시면 이어서 열 수 있어요.
            </p>
            <p className="hint">
              이미 입금하셨다면 주문번호와 함께{" "}
              <a href={`mailto:${BUSINESS.email}?subject=${encodeURIComponent(`[입금 확인 문의] ${order.orderNo}`)}`}>
                {BUSINESS.email}
              </a>
              로 알려주세요. 바로 확인해서 열어드릴게요.
            </p>
            <div className="share-actions">
              <button
                className="btn"
                onClick={() => {
                  setExpired(false);
                  setOrder(null);
                }}
              >
                다시 주문하기
              </button>
              <button className="btn secondary" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>주문이 접수됐어요</h3>
            <div className="order-no">
              주문번호 <b>{order.orderNo}</b>
            </div>

            {BANK_ACCOUNT && (
              <div className="order-bank">
                <div className="hint">아래 계좌로 {price.toLocaleString()}원을 보내주세요</div>
                <div className="order-bank-row">
                  <b>{BANK_ACCOUNT}</b>
                  <button type="button" className="btn secondary small" onClick={copyAccount}>
                    {copied ? "복사됨 ✓" : "복사"}
                  </button>
                </div>
              </div>
            )}

            <p className="hint" style={{ margin: "10px 0 0" }}>
              입금 기한은 <b>{deadlineText(order.at)}까지</b>예요. 기한이 지나면 주문이 자동으로
              취소돼요.
            </p>

            <p style={{ margin: "12px 0" }}>
              이 창을 열어두시면 30초마다 자동으로 입금을 확인해요. 창을 닫으셨다면 확인
              이메일을 받은 뒤 이 페이지에 다시 들어오시면(새로고침) 이어서 볼 수 있습니다.
            </p>

            {checkedNote && <div className="hint">{checkedNote}</div>}

            <div className="share-actions">
              <button className="btn" onClick={() => verify(order, true)} disabled={checking}>
                {checking ? "확인하는 중…" : "입금했어요, 확인해주세요"}
              </button>
              <button className="btn secondary" onClick={onClose}>
                닫기
              </button>
            </div>

            <p className="hint" style={{ marginTop: 12 }}>
              보통 몇 시간 안에 확인됩니다. 오래 걸리면 주문번호 <b>{order.orderNo}</b>와 함께{" "}
              <a href={`mailto:${BUSINESS.email}?subject=${encodeURIComponent(
                `[입금 확인 문의] ${order.orderNo}`,
              )}`}>
                {BUSINESS.email}
              </a>
              로 문의해주세요.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
