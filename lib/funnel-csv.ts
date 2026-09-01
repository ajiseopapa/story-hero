"use client";

/**
 * 퍼널 지표 CSV 내보내기.
 *
 * 서버에 쌓이는 건 **날짜 × 이벤트 카운터**뿐이다(lib/stats.ts). 세션 id도 시각도 없다.
 * 그래서 여기서 만들 수 있는 최대치는 아래 세 장이고, 그 이상(체류시간·재방문·경로)은
 * 추적을 더 심기 전에는 어떤 형태로 내보내도 나오지 않는다.
 *
 *  1) 이벤트 원본(long)  — 피벗용. 한 줄 = 하루 × 이벤트 하나.
 *  2) 퍼널 일별(wide)    — 엑셀에서 바로 꺾은선 그리는 용도.
 *  3) 주문               — 카드결제(pay:done) 밖에 있는 계좌이체 전환은 이 파일로만 읽힌다.
 *
 * ⭐ 주문 파일에는 이름·이메일을 넣지 않는다. 퍼널 분석에 필요 없는 개인정보이고,
 *    파일로 나가면 회수가 안 된다. 책 제목도 뺀다 — 아이 이름이 들어 있다.
 */

/** 이벤트가 "사람 수"인지 "행동 수"인지. 섞어서 읽으면 전환율이 무너진다. */
const SESSION_STEPS = new Set([
  "visit",
  "photo",
  "sample:start",
  "sample:done",
  "pay:click",
  "pay:click:resume",
  "book:view",
]);

/** 서버에서 기록하는 건별 이벤트 — 브라우저 세션 중복제거와 무관하다. */
const SERVER_STEPS = new Set(["order:submit", "pay:done"]);

/**
 * 이벤트 이름 → 단위.
 *  session: 브라우저 세션당 1회 (사람 수에 가깝다, lib/track.ts)
 *  server:  서버가 건별로 기록
 *  action:  발생할 때마다 (그림체·주제·재시도 — 한 사람이 여러 번 세어진다)
 */
export function unitOf(step: string): "session" | "server" | "action" {
  if (SESSION_STEPS.has(step)) return "session";
  if (SERVER_STEPS.has(step)) return "server";
  return "action";
}

/** `src:reel1:sample:done` → { source: "reel1", step: "sample:done" }. 단계 이름에도 콜론이 있어 첫 콜론에서만 자른다. */
export function splitEvent(key: string): { source: string; step: string } {
  if (!key.startsWith("src:")) return { source: "", step: key };
  const rest = key.slice(4);
  const cut = rest.indexOf(":");
  if (cut <= 0) return { source: "", step: key };
  return { source: rest.slice(0, cut), step: rest.slice(cut + 1) };
}

export type Cell = string | number;

/** 엑셀이 수식으로 해석하는 첫 글자는 막는다(=, +, -, @ 로 시작하는 값). */
function csvCell(v: Cell): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** BOM을 붙여 내려받는다 — 없으면 엑셀에서 한글이 깨진다. */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface DailyRow {
  date: string;
  counts: Record<string, number>;
}

/** ① 이벤트 원본 — 한 줄 = 하루 × 이벤트 하나. 출처·단계·단위를 컬럼으로 쪼개야 피벗이 돈다. */
export function eventRows(daily: DailyRow[]): Cell[][] {
  const rows: Cell[][] = [["date", "event", "source", "step", "unit", "count"]];
  for (const d of daily) {
    for (const key of Object.keys(d.counts).sort()) {
      const { source, step } = splitEvent(key);
      rows.push([d.date, key, source, step, unitOf(step), d.counts[key] ?? 0]);
    }
  }
  return rows;
}

/** ② 퍼널 일별 — 한 줄 = 하루. 계좌이체 주문 접수까지 붙여야 마지막 칸이 읽힌다. */
export function funnelRows(
  daily: DailyRow[],
  steps: { key: string; label: string }[],
): Cell[][] {
  const cols = [...steps, { key: "order:submit", label: "계좌이체 주문" }];
  const rows: Cell[][] = [["날짜", ...cols.map((s) => s.label)]];
  for (const d of daily) rows.push([d.date, ...cols.map((s) => d.counts[s.key] ?? 0)]);
  return rows;
}

export interface ExportOrder {
  id: string;
  amount: number;
  status: string;
  createdAt: number;
  paidAt?: number;
  source?: string;
  referrer?: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "입금대기",
  paid: "입금확인",
  canceled: "취소",
};

/** 한국 시간 `YYYY-MM-DD HH:mm` — 퍼널 집계도 KST 기준이라 날짜가 어긋나면 안 된다. */
export function kstStamp(ms?: number): string {
  if (!ms) return "";
  const t = new Date(ms + 9 * 60 * 60 * 1000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
}

/** ③ 주문 — 이름·이메일·책 제목(아이 이름)은 넣지 않는다. */
export function orderRows(orders: ExportOrder[]): Cell[][] {
  const rows: Cell[][] = [
    ["주문번호", "접수일시(KST)", "상태", "금액", "유입꼬리표", "유입링크", "입금확인일시(KST)"],
  ];
  for (const o of orders) {
    rows.push([
      o.id.slice(0, 8).toUpperCase(),
      kstStamp(o.createdAt),
      STATUS_LABEL[o.status] ?? o.status,
      o.amount ?? 0,
      o.source ?? "",
      o.referrer ?? "",
      kstStamp(o.paidAt),
    ]);
  }
  return rows;
}
