"use client";

// 퍼널 대시보드 (후기 검수와 같은 키 — API엔 헤더로만 보낸다, lib/admin-key 참고).
// 방문자용 화면은 몰라도 관리 화면은 한국어로 읽혀야 한다.
import { useCallback, useEffect, useState } from "react";
import { recallAdminKey } from "@/lib/admin-key";
import {
  type ExportOrder,
  downloadCsv,
  eventRows,
  funnelRows,
  kstStamp,
  orderRows,
} from "@/lib/funnel-csv";

interface Step {
  key: string;
  label: string;
  note: string;
  count: number;
  fromPrev: number | null;
  fromTop: number | null;
}

interface Data {
  days: number;
  configured: boolean;
  steps: Step[];
  extra: { key: string; label: string; count: number }[];
  breakdown: Record<string, Record<string, number>>;
  sources: Record<string, Record<string, number>>;
  devices: Record<string, Record<string, number>>;
  testUrl: string | null;
  daily: { date: string; counts: Record<string, number> }[];
  leakExclude: string[];
}

const ART_LABEL: Record<string, string> = {
  realistic: "사실적 그림",
  watercolor: "수채화",
  pencil: "색연필",
  crayon: "크레파스",
};

const THEME_LABEL: Record<string, string> = {
  space: "우주 여행",
  ocean: "해저 탐험",
  animals: "동물 친구들",
  dino: "공룡 시대",
  forest: "마법의 숲",
  cloud: "구름 위 모험",
  treasure: "보물섬 탐험",
  winter: "눈의 나라",
  candy: "과자 나라",
  castle: "왕국과 성",
  train: "마법 기차",
  jungle: "정글 탐험",
};

const DEVICE_LABEL: Record<string, string> = { ios: "아이폰", aos: "안드로이드", pc: "PC" };

const APP_LABEL: Record<string, string> = {
  insta: "인스타 인앱",
  threads: "스레드 인앱",
  kakao: "카톡 인앱",
  fb: "페북 인앱",
  naver: "네이버 인앱",
  daum: "다음 인앱",
  line: "라인 인앱",
  inapp: "이름 모를 인앱",
};

/** `ios-insta` → `아이폰 · 인스타 인앱` */
function deviceLabel(bucket: string): string {
  const [plat, app] = bucket.split("-");
  const base = DEVICE_LABEL[plat] ?? plat;
  return app ? `${base} · ${APP_LABEL[app] ?? app}` : base;
}

/** 출처별·기기별 퍼널은 표 모양이 같다 — 한 곳에서 그린다. */
function StepTable({
  head,
  rows,
  steps,
  label,
}: {
  head: string;
  rows: [string, Record<string, number>][];
  steps: { key: string; label: string }[];
  label?: (name: string) => string;
}) {
  const visitKey = steps[0]?.key ?? "visit";
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: ".9rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>{head}</th>
            {steps.map((s) => (
              <th key={s.key} style={{ textAlign: "right", padding: "6px 8px" }}>
                {s.label}
              </th>
            ))}
            <th style={{ textAlign: "right", padding: "6px 8px" }}>구매의사율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, counts]) => {
            const visits = counts[visitKey] ?? 0;
            return (
              <tr key={name} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                  <b>{label ? label(name) : name}</b>
                </td>
                {steps.map((s) => (
                  <td
                    key={s.key}
                    style={{
                      textAlign: "right",
                      padding: "6px 8px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {counts[s.key] ?? 0}
                  </td>
                ))}
                <td
                  style={{
                    textAlign: "right",
                    padding: "6px 8px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {visits > 0 ? `${Math.round(((counts["pay:click"] ?? 0) / visits) * 100)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 날짜×출처 표에서 세로로 볼 단계 — 방문은 도달, 구매 의사는 주문 직전이라 주문 추정에 가깝다. */
const CROSS_STEPS = [
  { key: "pay:click", label: "구매 의사" },
  { key: "sample:done", label: "샘플 완성" },
  { key: "visit", label: "방문" },
] as const;

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export default function FunnelAdminPage() {
  const [key, setKey] = useState("");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [origin, setOrigin] = useState("");
  const [crossStep, setCrossStep] = useState<string>("pay:click");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setKey(recallAdminKey());
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async (k: string, d: number) => {
    if (!k) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/stats/admin?days=${d}`, { headers: { "x-admin-key": k } });
      if (!res.ok) {
        setError("관리자 키가 올바르지 않아요.");
        setData(null);
        return;
      }
      setData((await res.json()) as Data);
    } catch {
      setError("불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (key) load(key, days);
  }, [key, days, load]);

  // 파일 이름에 기간을 박아둔다 — 여러 번 뽑아도 뭘 뽑은 건지 파일명만 보고 읽힌다.
  const from = data?.daily[0]?.date ?? "";
  const to = data?.daily[data.daily.length - 1]?.date ?? "";
  const range = `${from}_${to}`;

  // 주문은 퍼널 API에 없다(개인정보라 저장소가 다르다) — 받을 때만 따로 불러온다.
  const downloadOrders = useCallback(async () => {
    if (!key) return;
    setExportError(null);
    setExporting(true);
    try {
      const res = await fetch("/api/order/admin", { headers: { "x-admin-key": key } });
      if (!res.ok) {
        setExportError("주문을 불러오지 못했어요.");
        return;
      }
      const { orders } = (await res.json()) as { orders: ExportOrder[] };
      // 화면에서 고른 기간과 같은 구간만 자른다 — 퍼널 숫자와 나란히 놓고 읽으려면 기간이 맞아야 한다.
      const inRange = orders.filter((o) => {
        const day = kstStamp(o.createdAt).slice(0, 10);
        return day >= from && day <= to;
      });
      downloadCsv(`kidsbook-orders-${range}.csv`, orderRows(inRange));
    } catch {
      setExportError("주문을 불러오지 못했어요.");
    } finally {
      setExporting(false);
    }
  }, [key, from, to, range]);

  const top = data?.steps[0]?.count ?? 0;

  // 가장 크게 새는 구간 — 여기를 고치는 게 항상 가장 남는 장사다.
  // 카드 결제(pay:done)는 아직 안 열어서 항상 0이라 계산에서 뺀다(서버가 leakExclude로 알려준다).
  const exclude = new Set(data?.leakExclude ?? []);
  const worst =
    data?.steps
      .slice(1)
      .filter((s) => s.fromPrev !== null && !exclude.has(s.key))
      .sort((a, b) => (a.fromPrev ?? 1) - (b.fromPrev ?? 1))[0] ?? null;

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">퍼널 지표 🔒</span>
        <h1>어디서 새고 있나</h1>
        <p>방문부터 결제까지 각 단계에 몇 명이 도달했는지 봅니다.</p>
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

      {data && !data.configured && (
        <div className="error">
          저장소(KV)가 연결돼 있지 않습니다. 지금 숫자는 서버 메모리에만 쌓여 재시작하면
          사라집니다. Vercel에 <code>KV_REST_API_URL</code>·<code>KV_REST_API_TOKEN</code>을
          설정하세요.
        </div>
      )}

      {data && (
        <>
          <section className="card">
            <div className="share-actions" style={{ marginBottom: 4 }}>
              {[7, 30, 60, 90].map((d) => (
                <button
                  key={d}
                  className={`btn ${days === d ? "" : "secondary"}`}
                  onClick={() => setDays(d)}
                  disabled={loading}
                >
                  최근 {d}일
                </button>
              ))}
            </div>
          </section>

          {data.testUrl && (
            <section className="card">
              <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>테스트 링크</h2>
              <div className="hint" style={{ marginBottom: 10 }}>
                이 링크로 연 브라우저는 <b>하루 3회 한도를 건너뛰고</b>, 그 브라우저에서 만든
                방문·클릭은 <b>퍼널 집계에서 빠집니다</b>. 인앱 브라우저를 확인할 때 이 링크를
                나에게 DM으로 보내 앱 안에서 열면 됩니다. 한 번 열면 30일간 유지돼요.
                <br />
                남에게 주지 마세요 — 무료 샘플 한도를 건너뛰는 링크입니다.
              </div>
              <div className="share-actions">
                <button
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard?.writeText(data.testUrl ?? "");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "복사했어요 ✓" : "링크 복사"}
                </button>
                <a className="btn secondary" href={`${origin}/?test=0`}>
                  집계 다시 켜기
                </a>
              </div>
              <div
                className="hint"
                style={{ marginTop: 10, wordBreak: "break-all", fontFamily: "monospace" }}
              >
                {data.testUrl}
              </div>
            </section>
          )}

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>CSV 내보내기</h2>
            <div className="hint" style={{ marginBottom: 10 }}>
              위에서 고른 <b>최근 {data.days}일</b>({from} ~ {to}) 구간을 그대로 내보냅니다. 엑셀에서
              바로 열려요.
            </div>
            <div className="share-actions">
              <button
                className="btn"
                onClick={() => downloadCsv(`kidsbook-events-${range}.csv`, eventRows(data.daily))}
              >
                이벤트 원본
              </button>
              <button
                className="btn secondary"
                onClick={() =>
                  downloadCsv(`kidsbook-funnel-${range}.csv`, funnelRows(data.daily, data.steps))
                }
              >
                퍼널(일별)
              </button>
              <button className="btn secondary" onClick={downloadOrders} disabled={exporting}>
                {exporting ? "받는 중…" : "주문"}
              </button>
            </div>
            {exportError && (
              <div className="error" style={{ marginTop: 10 }}>
                {exportError}
              </div>
            )}
            <ul className="hint" style={{ margin: "10px 0 0", paddingLeft: 18 }}>
              <li>
                <b>이벤트 원본</b> — 한 줄이 하루 × 이벤트 하나. 출처(<code>?s=</code>)와 단계가
                컬럼으로 갈라져 있어 피벗으로 바로 돌립니다. <code>unit</code>이{" "}
                <code>session</code>인 것만 사람 수예요 — <code>action</code>(그림체·주제·재시도)은
                발생할 때마다 세니 전환율 계산에 섞으면 안 됩니다.
              </li>
              <li>
                <b>퍼널(일별)</b> — 한 줄이 하루. 카드결제는 아직 안 열었으니 계좌이체 주문 접수까지
                붙여뒀습니다.
              </li>
              <li>
                <b>주문</b> — 금액·상태·유입만 담습니다. 이름·이메일·책 제목(아이 이름)은
                개인정보라 파일에 넣지 않아요.
              </li>
            </ul>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>퍼널</h2>
            {top === 0 ? (
              <div className="hint">
                아직 방문 기록이 없어요. 홍보를 시작하면 여기에 숫자가 쌓입니다.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
                {data.steps.map((s) => (
                  <div key={s.key}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <strong>{s.label}</strong>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        <b style={{ fontSize: "1.15rem" }}>{s.count}</b>
                        <span className="hint" style={{ marginLeft: 8 }}>
                          방문 대비 {pct(s.fromTop)}
                          {s.fromPrev !== null && ` · 직전 대비 ${pct(s.fromPrev)}`}
                        </span>
                      </span>
                    </div>
                    <div
                      style={{
                        height: 10,
                        borderRadius: 999,
                        background: "rgba(0,0,0,.07)",
                        overflow: "hidden",
                        margin: "6px 0 4px",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max((s.count / top) * 100, s.count > 0 ? 2 : 0)}%`,
                          borderRadius: 999,
                          background:
                            s.key === "pay:done"
                              ? "#16a34a"
                              : worst && s.key === worst.key
                                ? "#dc2626"
                                : "#3182f6",
                        }}
                      />
                    </div>
                    <div className="hint">{s.note}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>어디서 왔나</h2>
            <div className="hint" style={{ marginBottom: 10 }}>
              뿌리는 링크 뒤에 <code>?s=이름</code>을 붙이면 그 이름으로 따로 쌓입니다. 릴스마다
              다른 이름을 주면 어느 릴스가 사람을 데려왔는지 갈라 볼 수 있어요.
              <br />예: <code>{origin}/?s=reel1</code> · <code>{origin}/?s=dm</code>
              <br />
              이름은 영어 소문자·숫자·하이픈만 쓰세요. 꼬리표를 안 붙인 방문은 위 전체 퍼널에만
              들어갑니다.
            </div>
            {(() => {
              const visitKey = data.steps[0]?.key ?? "visit";
              const rows = Object.entries(data.sources ?? {}).sort(
                (a, b) => (b[1][visitKey] ?? 0) - (a[1][visitKey] ?? 0),
              );
              if (rows.length === 0) {
                return <div className="hint">아직 꼬리표가 붙은 방문이 없어요.</div>;
              }
              return <StepTable head="출처" rows={rows} steps={data.steps} />;
            })()}
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>기기·브라우저</h2>
            <div className="hint" style={{ marginBottom: 10 }}>
              꼬리표와 달리 <b>모든 방문</b>이 여기 잡힙니다. 인스타·카톡 인앱 브라우저는 사진
              선택이 막히는 일이 있어요 — <b>사진 선택창 엶</b> 대비 <b>사진 고름</b>이 유독 낮은
              줄이 있으면 그 브라우저가 막고 있다는 뜻입니다.
            </div>
            {(() => {
              const visitKey = data.steps[0]?.key ?? "visit";
              const rows = Object.entries(data.devices ?? {}).sort(
                (a, b) => (b[1][visitKey] ?? 0) - (a[1][visitKey] ?? 0),
              );
              if (rows.length === 0) {
                return (
                  <div className="hint">
                    아직 기록이 없어요. 이 기능을 배포한 뒤 들어온 방문부터 쌓입니다.
                  </div>
                );
              }
              return <StepTable head="기기" rows={rows} steps={data.steps} label={deviceLabel} />;
            })()}
          </section>

          {worst && worst.fromPrev !== null && top > 0 && (
            <section className="card">
              <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>가장 크게 새는 곳</h2>
              <p style={{ margin: "8px 0" }}>
                <b>{worst.label}</b> 단계에서 직전 대비 <b>{pct(worst.fromPrev)}</b>만 넘어옵니다.
                여기를 고치는 게 가장 남는 작업입니다.
              </p>
            </section>
          )}

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>참고 지표</h2>
            <div className="hint" style={{ marginBottom: 8 }}>
              퍼널과 달리 발생할 때마다 셉니다(같은 사람이 여러 번 세어질 수 있어요).
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.extra.map((e) => (
                <li key={e.key}>
                  {e.label}: <b>{e.count}</b>
                </li>
              ))}
            </ul>
          </section>

          {(["art", "theme", "kids"] as const).map((group) => {
            const rows = Object.entries(data.breakdown[group] ?? {}).sort((a, b) => b[1] - a[1]);
            if (rows.length === 0) return null;
            const title =
              group === "art" ? "그림체" : group === "theme" ? "이야기 주제" : "아이 수";
            const label = (k: string) =>
              group === "art"
                ? (ART_LABEL[k] ?? k)
                : group === "theme"
                  ? (THEME_LABEL[k] ?? k)
                  : `${k}명`;
            const sum = rows.reduce((a, [, v]) => a + v, 0);
            return (
              <section className="card" key={group}>
                <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{title}</h2>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {rows.map(([k, v]) => (
                    <li key={k}>
                      {label(k)}: <b>{v}</b>{" "}
                      <span className="hint">({Math.round((v / sum) * 100)}%)</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {(() => {
            // 날짜 × 출처 — 유입이 저장되기 전(2026-08-31 이전) 주문이 어디서 왔는지
            // 되짚어보려고 만든 표다. 주문일에 어느 꼬리표가 움직였는지 보여줄 뿐,
            // "이 주문 = 이 링크"를 증명하지는 못한다. 하루 주문이 한 건일 때만 쓸 만하다.
            const rows = data.daily
              .map((d) => {
                const per: Record<string, number> = {};
                for (const [k, v] of Object.entries(d.counts)) {
                  if (!k.startsWith("src:")) continue;
                  const rest = k.slice(4);
                  const cut = rest.indexOf(":");
                  if (cut <= 0 || rest.slice(cut + 1) !== crossStep) continue;
                  per[rest.slice(0, cut)] = v;
                }
                return { date: d.date, per, orders: d.counts["order:submit"] ?? 0 };
              })
              .filter((r) => Object.keys(r.per).length > 0 || r.orders > 0)
              .reverse();
            const names = [...new Set(rows.flatMap((r) => Object.keys(r.per)))].sort();
            if (rows.length === 0) return null;
            return (
              <section className="card">
                <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>날짜별 출처</h2>
                <div className="hint" style={{ marginBottom: 10 }}>
                  주문일에 어느 꼬리표가 움직였는지 봅니다. 유입 저장 기능이 붙기 전(8/31 이전)
                  주문이 어디서 왔는지 <b>추정</b>할 때 쓰세요 — 그날 주문이 한 건이고 움직인
                  꼬리표도 하나라면 사실상 그 링크입니다. 증거는 아닙니다.
                </div>
                <div className="share-actions" style={{ marginBottom: 10 }}>
                  {CROSS_STEPS.map((s) => (
                    <button
                      key={s.key}
                      className={`btn ${crossStep === s.key ? "" : "secondary"}`}
                      onClick={() => setCrossStep(s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: ".9rem" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>날짜</th>
                        <th style={{ textAlign: "right", padding: "6px 8px" }}>주문</th>
                        {names.map((n) => (
                          <th key={n} style={{ textAlign: "right", padding: "6px 8px" }}>
                            {n}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.date} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.date}</td>
                          <td
                            style={{
                              textAlign: "right",
                              padding: "6px 8px",
                              fontVariantNumeric: "tabular-nums",
                              fontWeight: r.orders > 0 ? 700 : 400,
                            }}
                          >
                            {r.orders}
                          </td>
                          {names.map((n) => (
                            <td
                              key={n}
                              style={{
                                textAlign: "right",
                                padding: "6px 8px",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {r.per[n] ?? 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="hint" style={{ marginTop: 10 }}>
                  꼬리표를 안 붙인 유입은 이 표에 안 잡힙니다. 8/31 이후 주문은 주문 관리
                  화면에서 유입이 <b>주문별로</b> 바로 보입니다.
                </div>
              </section>
            );
          })()}

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>일별</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: ".9rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>날짜</th>
                    {data.steps.map((s) => (
                      <th key={s.key} style={{ textAlign: "right", padding: "6px 8px" }}>
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...data.daily]
                    .reverse()
                    .filter((d) => Object.keys(d.counts).length > 0)
                    .map((d) => (
                      <tr key={d.date} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{d.date}</td>
                        {data.steps.map((s) => (
                          <td
                            key={s.key}
                            style={{
                              textAlign: "right",
                              padding: "6px 8px",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {d.counts[s.key] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>
              기록이 하나도 없는 날은 표에서 뺐습니다. 날짜는 한국 시간 기준이에요.
            </div>
          </section>
        </>
      )}
    </main>
  );
}
