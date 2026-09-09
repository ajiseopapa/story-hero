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
import { deviceBucket, entrySource, trackEvery, trackStep } from "@/lib/track";
import { PAY_DEADLINE_DAYS, payDeadline } from "@/lib/order-terms";
import { parseBankAccount, platformOf, tossSendUrl } from "@/lib/transfer-link";

const BANK_ACCOUNT = process.env.NEXT_PUBLIC_BANK_ACCOUNT ?? "";
const ACCOUNT = parseBankAccount(BANK_ACCOUNT);

export type BankOrder = {
  id: string;
  token: string;
  orderNo: string;
  at: number;
  /** 입금자명 — 새로고침해서 돌아와도 "이 이름으로 보내세요"를 다시 보여주려고 함께 저장한다 */
  name?: string;
};

const STORE_KEY = "bankOrder";
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  // 현금영수증 — 필요한 사람만 펼친다. 기본은 접힘이라 안 쓰는 손님에게는 칸이 늘지 않는다.
  const [wantReceipt, setWantReceipt] = useState(false);
  const [receiptKind, setReceiptKind] = useState<"personal" | "business">("personal");
  const [receiptNo, setReceiptNo] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 30초 자동 확인과 수동 확인 버튼이 동시에 입금을 감지해도 onPaid는 한 번만 부른다
  // (두 번 부르면 남은 장면 생성이 두 벌 돌아 비용이 2배로 나간다)
  const paidNotifiedRef = useRef(false);

  // 이미 접수한 주문이 있으면 그 화면부터 보여준다
  useEffect(() => {
    loadBankOrder().then((saved) => {
      if (saved) setOrder(saved);
      // 주문 폼이 실제로 뜬 사람. pay:click과 이 숫자의 차이가 곧 창이 안 뜬 사고다.
      else trackStep("order:open");
    });
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
    // 버튼을 죽여두지 않는다 — 왜 안 눌리는지 모른 채 나가는 사람이 있었다.
    // 누르면 어디가 비었는지 말해주고, 눌렀다는 사실 자체도 지표로 남긴다.
    trackStep("order:try");
    if (!name.trim()) {
      setError("입금하실 분 이름을 적어주세요.");
      return;
    }
    if (!EMAIL_OK.test(email.trim())) {
      setError("이메일 주소를 다시 확인해주세요.");
      return;
    }
    if (wantReceipt && !receiptNo.replace(/[^0-9]/g, "")) {
      setError("현금영수증 번호를 적어주세요. 필요 없으시면 체크를 풀어주세요.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 유입 정보(꼬리표·유입 호스트)도 함께 — 어느 링크가 실제 주문까지 왔는지 보려고
        body: JSON.stringify({
          name,
          email,
          bookTitle,
          ...entrySource(),
          ...(wantReceipt ? { receiptKind, receiptNo } : {}),
        }),
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
        name: name.trim(),
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

  // 토스 송금 링크는 휴대폰에서만 열린다 — 서버 렌더와 어긋나지 않게 마운트 뒤에 정한다.
  const [tossUrl, setTossUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ACCOUNT) return;
    setTossUrl(tossSendUrl(ACCOUNT, price, platformOf(deviceBucket(navigator.userAgent || ""))));
  }, [price]);

  const canSubmit = name.trim().length > 0 && EMAIL_OK.test(email.trim());

  // 주문 창 안에서 어디까지 왔는지 남긴다. 구매 의사 18 → 주문 접수 3인데(2026-09-09),
  // 창을 보고 그냥 닫았는지 쓰다 말았는지 다 쓰고도 안 눌렀는지 구분할 길이 없었다.
  const onName = (v: string) => {
    setName(v);
    if (v.trim()) trackStep("order:name");
  };
  const onEmail = (v: string) => {
    setEmail(v);
    if (EMAIL_OK.test(v.trim())) trackStep("order:email");
  };
  useEffect(() => {
    if (canSubmit) trackStep("order:ready");
  }, [canSubmit]);
  // 첫 화면에서 쿠폰을 적어 둔 손님 — 계좌 안내는 감추고 "쿠폰으로 열기"를 앞세운다
  const [couponFirst, setCouponFirst] = useState(
    initialCoupon.replace(/[^A-Za-z0-9]/g, "").length >= 4,
  );

  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal-card">
        {!order ? (
          <>
            <h3 style={{ marginTop: 0 }}>
              {couponFirst ? "쿠폰으로 전체 열기" : "계좌이체로 주문하기"}
            </h3>
            <p className="hint" style={{ marginTop: 4 }}>
              {couponFirst
                ? "입금 없이 쿠폰으로 열어드려요. 이름과 이메일만 적어주세요. 누가 열었는지 남기고 안내 메일을 보내기 위해서예요."
                : "계좌이체로 받고 있어요. 이름과 이메일을 남기고 아래 계좌로 입금해 주시면, 확인되는 대로 나머지 장면과 PDF·소리책이 모두 열립니다. 확인은 보통 몇 시간 안에 끝나요."}
            </p>

            <div className="order-amount">
              <span>《 {bookTitle} 》 전체 보기</span>
              {couponFirst ? (
                <b>
                  <s style={{ fontWeight: 400, opacity: 0.6, marginRight: 6 }}>
                    {price.toLocaleString()}원
                  </s>
                  0원
                </b>
              ) : (
                <b>{price.toLocaleString()}원</b>
              )}
            </div>

            {couponFirst ? null : BANK_ACCOUNT ? (
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
              <label>{couponFirst ? "이름" : "입금하실 분 이름"}</label>
              <input
                type="text"
                value={name}
                maxLength={40}
                placeholder="이름을 적어주세요"
                onChange={(e) => onName(e.target.value)}
              />
              {!couponFirst && (
                <div className="hint" style={{ marginTop: 6 }}>
                  입금하실 때 이 이름으로 보내주시면 가장 빨리 찾아요. 가족 계좌처럼 다른
                  이름으로 보내셔도 주문번호로 찾아드리니 괜찮아요.
                </div>
              )}
            </div>
            <div className="field">
              <label>이메일</label>
              <input
                type="email"
                value={email}
                maxLength={120}
                placeholder="안내를 받으실 이메일 주소"
                onChange={(e) => onEmail(e.target.value)}
              />
            </div>

            {error && <div className="error">{error}</div>}

            {couponFirst ? (
              <>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>적용할 쿠폰</label>
                  <input
                    type="text"
                    value={coupon}
                    maxLength={20}
                    autoCapitalize="characters"
                    onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  />
                </div>
                {couponError && <div className="error">{couponError}</div>}
                <div className="share-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={useCoupon}
                    disabled={coupon.trim().length < 4 || !canSubmit || couponBusy}
                  >
                    {couponBusy ? "여는 중…" : "쿠폰으로 전체 열기 🎟️"}
                  </button>
                  <button className="btn secondary" onClick={onClose} disabled={couponBusy}>
                    닫기
                  </button>
                </div>
                <p className="hint" style={{ marginTop: 12 }}>
                  쿠폰이 없다면{" "}
                  <button type="button" className="link-btn" onClick={() => setCouponFirst(false)}>
                    계좌이체로 주문하기
                  </button>
                </p>
              </>
            ) : (
              <>
            {/* 현금영수증 — 계좌이체로 현금을 받으니 발급 경로가 있어야 한다.
                필요한 사람만 펼치게 접어 둔다: 안 쓰는 손님에게 칸을 늘리면
                지금 고치려는 그 마찰이 도로 늘어난다. 여기서 받는 건 번호뿐이고
                실제 발급은 입금 확인 뒤 홈택스에서 한다. */}
            <div className="receipt-box">
              <label className="receipt-toggle">
                <input
                  type="checkbox"
                  checked={wantReceipt}
                  onChange={(e) => {
                    setWantReceipt(e.target.checked);
                    if (e.target.checked) trackEvery("order:receipt");
                  }}
                />
                <span>현금영수증이 필요해요</span>
              </label>
              {wantReceipt && (
                <>
                  <div className="receipt-kinds">
                    <label>
                      <input
                        type="radio"
                        name="receiptKind"
                        checked={receiptKind === "personal"}
                        onChange={() => setReceiptKind("personal")}
                      />
                      <span>소득공제용</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="receiptKind"
                        checked={receiptKind === "business"}
                        onChange={() => setReceiptKind("business")}
                      />
                      <span>지출증빙용</span>
                    </label>
                  </div>
                  <div className="field" style={{ marginTop: 8 }}>
                    <label>{receiptKind === "business" ? "사업자등록번호" : "휴대폰 번호"}</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={receiptNo}
                      maxLength={14}
                      placeholder={receiptKind === "business" ? "10자리 숫자" : "010으로 시작하는 번호"}
                      onChange={(e) => setReceiptNo(e.target.value)}
                    />
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>
                    입금이 확인되면 발급해 드려요. 회사 경비로 처리하시면 지출증빙용을
                    골라주세요.
                  </div>
                </>
              )}
            </div>

            <div className="share-actions">
              <button className="btn" onClick={submit} disabled={busy}>
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
            )}
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
                {/* 계좌번호를 옮겨 적는 사이에 손님이 사라진다 — 은행·계좌·금액을 채운 채로
                    토스 송금 화면을 연다. 토스가 없거나 PC면 위 계좌번호를 그대로 쓰면 된다. */}
                {tossUrl && (
                  <a className="btn toss-send" href={tossUrl}>
                    토스로 송금하기
                  </a>
                )}
              </div>
            )}
            {tossUrl && (
              <p className="hint" style={{ margin: "8px 0 0" }}>
                토스 앱이 열리면 금액까지 채워져 있어요. 다른 은행 앱을 쓰시면 위 계좌번호를
                복사해서 보내주세요.
              </p>
            )}

            {/* 입금은 입금자명으로 찾는다 — 여기서 한 번 더 못 박아야 확인이 안 밀린다 */}
            {(order.name || name.trim()) && (
              <p className="hint" style={{ margin: "8px 0 0" }}>
                입금자명은 <b>{order.name || name.trim()}</b>으로 보내주세요. 가족 계좌처럼 다른
                이름으로 보내셨다면 주문번호 <b>{order.orderNo}</b>와 함께 아래 주소로 알려주시면
                바로 찾아드릴게요.
              </p>
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
