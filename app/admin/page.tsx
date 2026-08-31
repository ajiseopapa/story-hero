"use client";

/**
 * 관리 개요 — 아침에 한 번 열어 "어제 무슨 일이 있었나"를 한 화면에서 읽는 자리.
 *
 * 원칙 셋:
 *  1) 숫자 하나에 반드시 비교 대상을 붙인다. 방문 33은 아무 뜻도 없지만
 *     "직전 같은 기간보다 +18%"는 판단이 된다.
 *  2) 세어진 방식이 다른 값은 같은 줄에 놓지 않는다. 퍼널(세션당 1회)과
 *     주문(사람이 실제로 넣은 것)은 칸을 나눈다.
 *  3) 추정과 기록을 섞지 않는다. 꼬리표(?s=)가 없는 유입은 "기록 없음"이라 쓰고,
 *     그럴듯한 값으로 메우지 않는다.
 *
 * 데이터는 두 API를 한 번에 부른다 — 퍼널 카운터(/api/stats/admin)와 주문 목록(/api/order/admin).
 * 후기는 검수 대기 건수만 쓴다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { recallAdminKey, rememberAdminKey } from "@/lib/admin-key";
import { saveBadges } from "./shell";

interface Step {
  key: string;
  label: string;
  note: string;
  count: number;
  fromPrev: number | null;
  fromTop: number | null;
}
interface Stats {
  days: number;
  configured: boolean;
  steps: Step[];
  extra: { key: string; label: string; count: number }[];
  sources: Record<string, Record<string, number>>;
  daily: { date: string; counts: Record<string, number> }[];
  leakExclude: string[];
}
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
}
interface Review {
  id: string;
  approved: boolean;
  rating: number;
  createdAt: number;
}

const RANGES = [7, 30, 90];

/** 추이 차트에서 고를 수 있는 지표 */
const METRICS = [
  { key: "visit", label: "방문" },
  { key: "sample:done", label: "샘플 완성" },
  { key: "pay:click", label: "구매 의사" },
  { key: "order:submit", label: "주문" },
] as const;

const STATUS_LABEL = { pending: "입금 대기", paid: "입금 확인", canceled: "취소" } as const;

function won(n: number): string {
  return `${n.toLocaleString()}원`;
}
function pct(v: number | null, digits = 0): string {
  return v === null ? "—" : `${(v * 100).toFixed(digits)}%`;
}
function when(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}
/** 한국 시간 기준 오늘로부터 며칠 전인지 — 퍼널 카운터의 날짜 키와 같은 기준으로 끊는다 */
function kstDate(offsetDays = 0): string {
  const t = Date.now() + 9 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 주문 하나의 유입 표기 — 자동 기록만 쓴다. 메모(사람이 적은 추측)는 섞지 않는다. */
function entryOf(o: Order): { text: string; kind: "tag" | "ref" | "none" } {
  if (o.source) return { text: o.source, kind: "tag" };
  if (o.referrer) return { text: o.referrer, kind: "ref" };
  return { text: "기록 없음", kind: "none" };
}

export default function AdminOverviewPage() {
  const [key, setKey] = useState("");
  const [days, setDays] = useState(7);
  const [metric, setMetric] = useState<string>("visit");
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState<string>("");

  useEffect(() => {
    setKey(recallAdminKey());
  }, []);

  const load = useCallback(async (k: string, d: number) => {
    if (!k) return;
    setLoading(true);
    setError(null);
    try {
      const h = { "x-admin-key": k };
      // 직전 같은 기간과 견주려고 두 배로 받아온다(서버 상한 90일).
      const span = Math.min(d * 2, 90);
      const [s, o, r] = await Promise.all([
        fetch(`/api/stats/admin?days=${span}`, { headers: h }),
        fetch("/api/order/admin", { headers: h }),
        fetch("/api/review/admin", { headers: h }),
      ]);
      if (!s.ok || !o.ok) {
        setError("관리자 키가 올바르지 않아요.");
        setStats(null);
        setOrders(null);
        return;
      }
      rememberAdminKey(k);
      setStats((await s.json()) as Stats);
      const od = (await o.json()) as { orders: Order[] };
      setOrders(od.orders);
      // 후기는 실패해도 개요 전체를 막지 않는다 — 뱃지 하나가 비는 것뿐이다
      setReviews(r.ok ? ((await r.json()) as { reviews: Review[] }).reviews : []);
      setAt(when(Date.now()));
    } catch {
      setError("불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (key) load(key, days);
  }, [key, days, load]);

  // ----- 기간 자르기: 이번 기간 / 직전 같은 기간 -----
  const period = useMemo(() => {
    if (!stats) return null;
    const from = kstDate(days - 1);
    const prevFrom = kstDate(days * 2 - 1);
    const cur = stats.daily.filter((d) => d.date >= from);
    const prev = stats.daily.filter((d) => d.date >= prevFrom && d.date < from);
    const sum = (rows: typeof cur, k: string) =>
      rows.reduce((a, d) => a + (d.counts[k] ?? 0), 0);
    // 직전 기간 데이터가 통째로 비면(보관 기간 밖) 증감을 계산하지 않는다 — 0에서 늘어난 척하지 않게
    const hasPrev = prev.some((d) => Object.keys(d.counts).length > 0);
    return { cur, prev, sum, hasPrev, from };
  }, [stats, days]);

  const ordersIn = useMemo(() => {
    if (!orders) return [];
    const start = new Date(`${kstDate(days - 1)}T00:00:00+09:00`).getTime();
    return orders.filter((o) => o.createdAt >= start);
  }, [orders, days]);

  const ordersPrev = useMemo(() => {
    if (!orders) return [];
    const start = new Date(`${kstDate(days * 2 - 1)}T00:00:00+09:00`).getTime();
    const end = new Date(`${kstDate(days - 1)}T00:00:00+09:00`).getTime();
    return orders.filter((o) => o.createdAt >= start && o.createdAt < end);
  }, [orders, days]);

  // 사이드바 뱃지 — 처리할 일만 센다
  const pendingOrders = (orders ?? []).filter((o) => o.status === "pending").length;
  const pendingReviews = (reviews ?? []).filter((r) => !r.approved).length;
  useEffect(() => {
    if (orders) saveBadges({ orders: pendingOrders, reviews: pendingReviews });
  }, [orders, pendingOrders, pendingReviews]);

  const kpis = useMemo(() => {
    if (!period) return [];
    const { cur, prev, sum, hasPrev } = period;
    const paidIn = ordersIn.filter((o) => o.status === "paid");
    const paidPrev = ordersPrev.filter((o) => o.status === "paid");
    const visits = sum(cur, "visit");
    const visitsPrev = sum(prev, "visit");
    const rate = visits > 0 ? ordersIn.length / visits : null;
    const ratePrev = visitsPrev > 0 ? ordersPrev.length / visitsPrev : null;
    return [
      { label: "방문", now: visits, was: sum(prev, "visit"), fmt: (n: number) => `${n}` },
      {
        label: "샘플 완성",
        now: sum(cur, "sample:done"),
        was: sum(prev, "sample:done"),
        fmt: (n: number) => `${n}`,
      },
      {
        label: "구매 의사",
        now: sum(cur, "pay:click"),
        was: sum(prev, "pay:click"),
        fmt: (n: number) => `${n}`,
        note: "세션당 1회 — 사람 수가 아니다",
      },
      {
        label: "주문",
        now: ordersIn.length,
        was: ordersPrev.length,
        fmt: (n: number) => `${n}건`,
      },
      {
        label: "확인된 매출",
        now: paidIn.reduce((a, o) => a + o.amount, 0),
        was: paidPrev.reduce((a, o) => a + o.amount, 0),
        fmt: won,
      },
      {
        label: "방문→주문",
        now: rate === null ? 0 : rate * 100,
        was: ratePrev === null ? 0 : ratePrev * 100,
        fmt: (n: number) => `${n.toFixed(1)}%`,
        skipDelta: !hasPrev || ratePrev === null,
      },
    ].map((k) => {
      // 직전 기간이 0인 걸 "비교 불가"로 뭉뚱그리면, 처음 팔린 날과 데이터가 없는 날이
      // 같은 문구로 보인다. 셋을 갈라 쓴다: 비교 없음 / 신규 / 증감률.
      const kind: "none" | "new" | "flat" | "pct" =
        !hasPrev || k.skipDelta ? "none" : k.was === 0 ? (k.now > 0 ? "new" : "flat") : "pct";
      return { ...k, kind, delta: kind === "pct" ? (k.now - k.was) / k.was : null };
    });
  }, [period, ordersIn, ordersPrev]);

  // ----- 추이 차트 -----
  const chart = useMemo(() => {
    if (!period) return null;
    const rows = period.cur.map((d) => ({
      date: d.date,
      // 주문은 퍼널 카운터가 아니라 실제 주문 기록으로 센다 — 같은 화면에서 두 값이 어긋나면 안 된다
      v:
        metric === "order:submit"
          ? ordersIn.filter(
              (o) => new Date(o.createdAt + 9 * 3600 * 1000).toISOString().slice(0, 10) === d.date,
            ).length
          : (d.counts[metric] ?? 0),
    }));
    const max = Math.max(1, ...rows.map((r) => r.v));
    return { rows, max };
  }, [period, metric, ordersIn]);

  /**
   * 퍼널·참고 지표·출처를 **선택한 기간으로 다시 계산한다.**
   *
   * 서버는 비교용으로 두 배 기간(days*2)을 한 번에 주기 때문에, 응답에 들어 있는 합계
   * (stats.steps·extra·sources)는 항상 두 배 기간의 값이다. 그걸 그대로 그리면
   * "최근 7일"을 골라도 퍼널만 14일치가 보인다 — 한 화면에서 기간이 어긋난다.
   */
  const view = useMemo(() => {
    if (!stats || !period) return null;
    const { cur } = period;
    const total = (k: string) => cur.reduce((a, d) => a + (d.counts[k] ?? 0), 0);
    const top = total(stats.steps[0]?.key ?? "visit");
    const steps = stats.steps.map((s, i, arr) => {
      const count = total(s.key);
      const prev = i === 0 ? count : total(arr[i - 1].key);
      return {
        ...s,
        count,
        fromPrev: i === 0 ? null : prev > 0 ? count / prev : null,
        fromTop: top > 0 ? count / top : null,
      };
    });
    const extra = stats.extra.map((e) => ({ ...e, count: total(e.key) }));
    const sources: Record<string, Record<string, number>> = {};
    for (const d of cur) {
      for (const [k, v] of Object.entries(d.counts)) {
        if (!k.startsWith("src:")) continue;
        const rest = k.slice(4);
        const cut = rest.indexOf(":");
        if (cut <= 0) continue;
        const name = rest.slice(0, cut);
        const step = rest.slice(cut + 1);
        (sources[name] ??= {})[step] = (sources[name][step] ?? 0) + v;
      }
    }
    return { steps, extra, sources, top };
  }, [stats, period]);

  // ----- 출처별 성적 (꼬리표 방문 + 실제 주문) -----
  const sourceRows = useMemo(() => {
    if (!view) return [];
    const byName: Record<string, { visit: number; sample: number; pay: number; orders: number }> =
      {};
    for (const [name, counts] of Object.entries(view.sources)) {
      byName[name] = {
        visit: counts["visit"] ?? 0,
        sample: counts["sample:done"] ?? 0,
        pay: counts["pay:click"] ?? 0,
        orders: 0,
      };
    }
    for (const o of ordersIn) {
      const n = o.source;
      if (!n) continue;
      (byName[n] ??= { visit: 0, sample: 0, pay: 0, orders: 0 }).orders += 1;
    }
    return Object.entries(byName).sort((a, b) => b[1].visit - a[1].visit);
  }, [view, ordersIn]);

  const untaggedOrders = ordersIn.filter((o) => !o.source).length;

  const exclude = new Set(stats?.leakExclude ?? []);
  const worst =
    view?.steps
      .slice(1)
      .filter((s) => s.fromPrev !== null && !exclude.has(s.key))
      .sort((a, b) => (a.fromPrev ?? 1) - (b.fromPrev ?? 1))[0] ?? null;

  const top = view?.top ?? 0;

  return (
    <div className="wrap">
      <header className="hero">
        <span className="badge">개요</span>
        <h1>오늘 무슨 일이 있었나</h1>
        <p>
          최근 {days}일과 그 직전 {days}일을 견줍니다. 날짜는 한국 시간 기준이에요.
        </p>
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
          <p className="hint">
            한 번 넣으면 이 브라우저에 기억해두어, 다음부터는 주소에 키가 없어도 열립니다. 값은
            Vercel 환경변수 <b>REVIEW_ADMIN_KEY</b>에 있습니다.
          </p>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {stats && !stats.configured && (
        <div className="error">
          저장소(KV)가 연결돼 있지 않습니다. 지금 숫자는 서버 메모리에만 쌓여 재시작하면
          사라집니다.
        </div>
      )}

      {stats && period && view && (
        <>
          <div className="adm-toolbar">
            <div className="adm-seg">
              {RANGES.map((d) => (
                <button
                  key={d}
                  className={days === d ? "on" : ""}
                  onClick={() => setDays(d)}
                  disabled={loading}
                >
                  최근 {d}일
                </button>
              ))}
            </div>
            <button
              className="btn secondary"
              onClick={() => load(key, days)}
              disabled={loading}
              style={{ marginLeft: "auto" }}
            >
              {loading ? "불러오는 중…" : "새로고침"}
            </button>
            {at && <span className="hint">{at} 기준</span>}
          </div>

          {pendingOrders > 0 && (
            <div className="adm-alert">
              <span>💰</span>
              입금 확인을 기다리는 주문이 {pendingOrders}건 있습니다.
              <a href="/admin/orders">주문 화면 열기 →</a>
            </div>
          )}
          {pendingReviews > 0 && (
            <div className="adm-alert">
              <span>☆</span>
              검수 대기 중인 후기가 {pendingReviews}건 있습니다.
              <a href="/admin/reviews">후기 화면 열기 →</a>
            </div>
          )}

          <div className="adm-kpis">
            {kpis.map((k) => (
              <div className="adm-kpi" key={k.label}>
                <div className="k-top">{k.label}</div>
                <div className="k-val">{k.fmt(k.now)}</div>
                {k.kind === "none" && <div className="k-delta">직전 기간 기록 없음</div>}
                {k.kind === "flat" && <div className="k-delta">직전 기간에도 0</div>}
                {k.kind === "new" && (
                  <div className="k-delta up" title={`직전 ${days}일: ${k.fmt(0)}`}>
                    ✦ 신규<span className="k-was">직전 {k.fmt(0)}</span>
                  </div>
                )}
                {k.kind === "pct" && k.delta !== null && (
                  <div
                    className={`k-delta ${k.delta > 0 ? "up" : k.delta < 0 ? "down" : ""}`}
                    title={`직전 ${days}일: ${k.fmt(k.was)}`}
                  >
                    {k.delta > 0 ? "▲" : k.delta < 0 ? "▼" : "•"}{" "}
                    {Math.abs(k.delta * 100).toFixed(0)}%
                    <span className="k-was">직전 {k.fmt(k.was)}</span>
                  </div>
                )}
                {k.note && (
                  <div className="hint" style={{ fontSize: 11, marginTop: 6 }}>
                    {k.note}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="adm-grid two">
            {/* 추이 */}
            <section className="card">
              <div className="adm-cardhead">
                <div>
                  <h2>일별 추이</h2>
                  <div className="hint">막대는 하루치, 초록 점은 주문이 있던 날입니다.</div>
                </div>
                <div className="adm-seg">
                  {METRICS.map((m) => (
                    <button
                      key={m.key}
                      className={metric === m.key ? "on" : ""}
                      onClick={() => setMetric(m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {chart && chart.rows.length > 0 ? (
                <Trend rows={chart.rows} max={chart.max} orders={ordersIn} />
              ) : (
                <div className="adm-empty">아직 기록이 없어요.</div>
              )}
            </section>

            {/* 퍼널 */}
            <section className="card">
              <div className="adm-cardhead">
                <div>
                  <h2>퍼널 (최근 {days}일)</h2>
                  <div className="hint">세션당 한 번씩 셉니다. 사람 수에 가깝습니다.</div>
                </div>
                <a className="btn secondary" href="/admin/funnel">
                  자세히
                </a>
              </div>
              {top === 0 ? (
                <div className="adm-empty">아직 방문 기록이 없어요.</div>
              ) : (
                view.steps.map((s) => (
                  <div
                    className={`adm-step${
                      s.key === worst?.key ? " leak" : s.key === "pay:done" ? " done" : ""
                    }`}
                    key={s.key}
                  >
                    <div className="s-row">
                      <span className="s-name">{s.label}</span>
                      <span className="s-num">
                        <b>{s.count}</b>
                        {s.fromPrev !== null && `직전 대비 ${pct(s.fromPrev)}`}
                      </span>
                    </div>
                    <div className="s-bar">
                      <div
                        className="s-fill"
                        style={{ width: `${Math.max((s.count / top) * 100, s.count > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                    {s.key === worst?.key && (
                      <div className="s-note">여기가 가장 크게 새는 구간입니다.</div>
                    )}
                  </div>
                ))
              )}
              {view.extra.some((e) => e.key === "pay:click:resume" && e.count > 0) && (
                <div className="hint" style={{ marginTop: 12 }}>
                  이어보기·결제 복귀로 돌아와 구매를 누른 건{" "}
                  <b>{view.extra.find((e) => e.key === "pay:click:resume")?.count}</b>건 — 위
                  퍼널에는 넣지 않았습니다(이번 세션에 샘플을 만든 사람이 아니라, 섞으면 전환율이
                  100%를 넘습니다).
                </div>
              )}
            </section>
          </div>

          <div className="adm-grid two">
            {/* 출처 */}
            <section className="card">
              <div className="adm-cardhead">
                <div>
                  <h2>유입 출처</h2>
                  <div className="hint">
                    링크에 <code>?s=이름</code>을 붙여 뿌린 것만 잡힙니다. 주문 열은 실제 주문
                    기록이고, 나머지는 퍼널 카운터입니다.
                  </div>
                </div>
              </div>
              {sourceRows.length === 0 ? (
                <div className="adm-empty">아직 꼬리표가 붙은 방문이 없어요.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>출처</th>
                        <th style={{ textAlign: "right" }}>방문</th>
                        <th style={{ textAlign: "right" }}>샘플</th>
                        <th style={{ textAlign: "right" }}>구매의사</th>
                        <th style={{ textAlign: "right" }}>주문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceRows.map(([name, v]) => (
                        <tr key={name}>
                          <td>
                            <span className="adm-pill tag">{name}</span>
                          </td>
                          <td style={{ textAlign: "right" }}>{v.visit}</td>
                          <td style={{ textAlign: "right" }}>{v.sample}</td>
                          <td style={{ textAlign: "right" }}>{v.pay}</td>
                          <td style={{ textAlign: "right", fontWeight: 650 }}>{v.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {untaggedOrders > 0 && (
                <div className="hint" style={{ marginTop: 10 }}>
                  이 기간 주문 {ordersIn.length}건 중 <b>{untaggedOrders}건</b>은 꼬리표 없이
                  들어왔습니다. 링크를 뿌릴 때 <code>?s=</code>를 빠뜨리면 어느 게시물이 데려왔는지
                  영영 알 수 없습니다.
                </div>
              )}
            </section>

            {/* 최근 주문 */}
            <section className="card">
              <div className="adm-cardhead">
                <div>
                  <h2>최근 주문</h2>
                  <div className="hint">유입은 8/31부터 주문마다 기록됩니다.</div>
                </div>
                <a className="btn secondary" href="/admin/orders">
                  전체
                </a>
              </div>
              {(orders ?? []).length === 0 ? (
                <div className="adm-empty">아직 주문이 없어요.</div>
              ) : (
                (orders ?? []).slice(0, 6).map((o) => {
                  const e = entryOf(o);
                  return (
                    <div className="adm-row" key={o.id}>
                      <div>
                        <div className="r-name">
                          {o.name}
                          <span
                            className={`adm-pill ${o.status}`}
                            style={{ marginLeft: 7, verticalAlign: 1 }}
                          >
                            {STATUS_LABEL[o.status]}
                          </span>
                        </div>
                        <div className="r-sub">
                          {o.bookTitle ? `《 ${o.bookTitle} 》 · ` : ""}
                          유입{" "}
                          <span className={`adm-pill ${e.kind === "none" ? "muted" : "tag"}`}>
                            {e.text}
                          </span>
                        </div>
                      </div>
                      <div className="r-right">
                        <div>{won(o.amount)}</div>
                        <div className="r-sub">{when(o.createdAt)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          </div>

          {/* 운영 지표 */}
          <section className="card">
            <div className="adm-cardhead">
              <div>
                <h2>운영 지표 (최근 {days}일)</h2>
                <div className="hint">
                  퍼널과 달리 발생할 때마다 셉니다. 같은 사람이 여러 번 세어질 수 있어요.
                </div>
              </div>
            </div>
            <div className="adm-kpis" style={{ marginTop: 0 }}>
              {view.extra.map((e) => (
                <div className="adm-kpi" key={e.key}>
                  <div className="k-top">{e.label}</div>
                  <div className="k-val" style={{ fontSize: 22 }}>
                    {e.count}
                  </div>
                </div>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 12 }}>
              여기 값을 위 퍼널 숫자로 나누지 마세요. 퍼널은 세션당 한 번, 이 값들은 발생할
              때마다 세므로 기준이 다릅니다 — 예컨대 "샘플 생성 실패 {
                view.extra.find((e) => e.key === "sample:fail")?.count ?? 0
              }회"는 재시도까지 포함한 횟수이고, "샘플 생성 시작 {
                view.steps.find((s) => s.key === "sample:start")?.count ?? 0
              }"은 사람 수에 가깝습니다.
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** 일별 막대 + 주문이 있던 날 표시. 라이브러리 없이 SVG로 그린다. */
function Trend({
  rows,
  max,
  orders,
}: {
  rows: { date: string; v: number }[];
  max: number;
  orders: { createdAt: number }[];
}) {
  const W = 640;
  const H = 170;
  const padL = 26;
  const padB = 18;
  const bw = (W - padL) / rows.length;
  const orderDays = new Set(
    orders.map((o) => new Date(o.createdAt + 9 * 3600 * 1000).toISOString().slice(0, 10)),
  );
  const ticks = [0, Math.round(max / 2), max];

  return (
    <>
      <svg className="adm-chart" viewBox={`0 0 ${W} ${H}`} role="img">
        {ticks.map((t) => {
          const y = H - padB - (t / max) * (H - padB - 10);
          return (
            <g key={t}>
              <line className="adm-gridline" x1={padL} y1={y} x2={W} y2={y} />
              <text className="adm-axis" x={0} y={y + 3}>
                {t}
              </text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const h = (r.v / max) * (H - padB - 10);
          const x = padL + i * bw;
          const isOrderDay = orderDays.has(r.date);
          return (
            <g key={r.date}>
              <rect
                className={`adm-bar${r.v === 0 ? " dim" : ""}`}
                x={x + bw * 0.16}
                y={H - padB - h}
                width={bw * 0.68}
                height={Math.max(h, r.v > 0 ? 2 : 0)}
                rx={2}
              >
                <title>{`${r.date} · ${r.v}`}</title>
              </rect>
              {isOrderDay && <circle className="adm-dot" cx={x + bw / 2} cy={H - padB + 7} r={3} />}
              {(i === 0 || i === rows.length - 1 || i === Math.floor(rows.length / 2)) && (
                <text className="adm-axis" x={x + bw / 2} y={H - 2} textAnchor="middle">
                  {r.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="adm-legend">
        <span>
          <i style={{ background: "var(--blue)" }} />
          선택한 지표
        </span>
        <span>
          <i style={{ background: "var(--green)", borderRadius: 999 }} />
          주문이 있던 날
        </span>
      </div>
    </>
  );
}
