"use client";

// 퍼널 대시보드. 주소에 ?key=... 를 붙여야 열린다 (후기 검수와 같은 키).
// 방문자용 화면은 몰라도 관리 화면은 한국어로 읽혀야 한다.
import { useCallback, useEffect, useState } from "react";
import { recallAdminKey } from "@/lib/admin-key";

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

  useEffect(() => {
    setKey(recallAdminKey());
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async (k: string, d: number) => {
    if (!k) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/stats/admin?key=${encodeURIComponent(k)}&days=${d}`);
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
              type="text"
              placeholder="주소 뒤에 ?key=... 를 붙이거나 여기에 입력"
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
              {[7, 30, 90].map((d) => (
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
              const payKey = "pay:click";
              const rows = Object.entries(data.sources ?? {}).sort(
                (a, b) => (b[1][visitKey] ?? 0) - (a[1][visitKey] ?? 0),
              );
              if (rows.length === 0) {
                return <div className="hint">아직 꼬리표가 붙은 방문이 없어요.</div>;
              }
              return (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{ borderCollapse: "collapse", width: "100%", fontSize: ".9rem" }}
                  >
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>출처</th>
                        {data.steps.map((s) => (
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
                              <b>{name}</b>
                            </td>
                            {data.steps.map((s) => (
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
                              {visits > 0
                                ? `${Math.round(((counts[payKey] ?? 0) / visits) * 100)}%`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
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
