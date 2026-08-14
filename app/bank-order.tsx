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

const BANK_ACCOUNT = process.env.NEXT_PUBLIC_BANK_ACCOUNT ?? "";

export type BankOrder = { id: string; token: string; orderNo: string; at: number };

const STORE_KEY = "bankOrder";

export async function loadBankOrder(): Promise<BankOrder | null> {
  return (await kvGet<BankOrder>(STORE_KEY)) ?? null;
}

export async function clearBankOrder(): Promise<void> {
  await kvDel(STORE_KEY);
}

/** 저장된 주문의 입금 확인 여부를 물어본다. 네트워크 실패는 조용히 넘긴다. */
export async function checkBankOrderPaid(order: BankOrder): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/order/status?id=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.token)}`,
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === "paid";
  } catch {
    return false;
  }
}

export default function BankOrderBox({
  bookTitle,
  price,
  onPaid,
  onClose,
}: {
  bookTitle: string;
  price: number;
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
  const [copied, setCopied] = useState(false);
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
      const paid = await checkBankOrderPaid(o);
      if (manual) setChecking(false);
      if (paid) {
        if (paidNotifiedRef.current) return;
        paidNotifiedRef.current = true;
        onPaid(o);
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
        body: JSON.stringify({ name, email, bookTitle }),
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
    } catch {
      setError("연결에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
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
              <label>입금하실 분 이름</label>
              <input
                type="text"
                value={name}
                maxLength={40}
                placeholder="통장에 찍히는 이름으로 적어주세요"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>이메일</label>
              <input
                type="email"
                value={email}
                maxLength={120}
                placeholder="입금 확인 안내를 받으실 주소"
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
