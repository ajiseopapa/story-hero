/**
 * 계좌이체 주문.
 *
 * 카드 결제(토스)를 열기 전 검증 기간 동안, 입금자명·이메일을 받아두고
 * TK님이 입금을 확인하면 상태를 바꿔 책을 열어주는 흐름.
 *
 * ⭐ 여기 저장되는 건 개인정보(이름·이메일)다. 퍼널 통계(lib/stats.ts)와 달리
 *    보관 기간을 두고(180일) 만료시키며, 열람은 관리자 키로만 가능하다.
 *    사진·동화 내용은 서버에 올리지 않는다 — 책은 사용자 브라우저에만 있다.
 */
import { pipeline, restConfig, toRecord } from "@/lib/kv";
import { randomBytes, timingSafeEqual } from "node:crypto";

const KEY = (id: string) => `kidsbook:order:${id}`;
const INDEX = "kidsbook:orders"; // 최신순 주문 id 목록
const RETENTION_DAYS = 180;
const MAX_INDEX = 2000;

export type OrderStatus = "pending" | "paid" | "canceled";

export interface Order {
  id: string;
  token: string; // 주문자 본인 확인용 (id만으로는 남의 주문 상태를 못 보게)
  name: string; // 입금자명
  email: string;
  amount: number;
  bookTitle: string;
  status: OrderStatus;
  createdAt: number;
  paidAt?: number;
  memo?: string; // 관리자 메모
  source?: string; // 유입 꼬리표 (?s=...) — 없으면 꼬리표 없이 들어온 것
  referrer?: string; // 유입 링크 호스트 (예: instagram.com)
}

export const ID_RE = /^[a-f0-9]{16}$/;
const TOKEN_RE = /^[a-f0-9]{32}$/;

export function newOrderId(): string {
  return randomBytes(8).toString("hex");
}

export function newOrderToken(): string {
  return randomBytes(16).toString("hex");
}

/** 길이가 달라도 안전하게 비교 (타이밍 공격 방지) */
export function tokenMatches(a: string, b: string): boolean {
  if (!TOKEN_RE.test(a) || !TOKEN_RE.test(b)) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** 화면에 보여줄 짧은 주문번호 (입금자가 문의할 때 쓰라고) */
export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export function isStoreReady(): boolean {
  return restConfig() !== null;
}

/**
 * 주문 저장.
 *
 * ⭐ `addToIndex`는 **새 주문일 때만** true여야 한다. 상태를 바꿀 때마다 LPUSH를 하면
 *    같은 id가 목록에 계속 쌓여서 관리 화면에 같은 주문이 여러 번 보인다(실제로 그랬다).
 */
async function writeOrder(order: Order, addToIndex: boolean): Promise<void> {
  const ttl = RETENTION_DAYS * 24 * 60 * 60;
  await pipeline([
    [
      "HSET",
      KEY(order.id),
      "id",
      order.id,
      "token",
      order.token,
      "name",
      order.name,
      "email",
      order.email,
      "amount",
      order.amount,
      "bookTitle",
      order.bookTitle,
      "status",
      order.status,
      "createdAt",
      order.createdAt,
      ...(order.paidAt ? ["paidAt", order.paidAt] : []),
      ...(order.memo ? ["memo", order.memo] : []),
      ...(order.source ? ["source", order.source] : []),
      ...(order.referrer ? ["referrer", order.referrer] : []),
    ],
    // HSET은 기존 필드를 지우지 않는다 — paid를 pending/canceled로 되돌릴 때
    // 이전 paidAt·memo가 남아 관리 화면에 유령 "확인 시각"이 보이지 않게 지운다.
    ...(order.paidAt ? [] : [["HDEL", KEY(order.id), "paidAt"]]),
    ...(order.memo ? [] : [["HDEL", KEY(order.id), "memo"]]),
    ["EXPIRE", KEY(order.id), ttl],
    ...(addToIndex
      ? [
          ["LPUSH", INDEX, order.id],
          ["LTRIM", INDEX, 0, MAX_INDEX - 1],
        ]
      : []),
  ]);
}

/** 새 주문 — 목록에도 올린다 */
export async function saveOrder(order: Order): Promise<void> {
  await writeOrder(order, true);
}

function parse(raw: unknown): Order | null {
  const r = toRecord(raw);
  if (!r.id) return null;
  const status: OrderStatus =
    r.status === "paid" ? "paid" : r.status === "canceled" ? "canceled" : "pending";
  return {
    id: r.id,
    token: r.token ?? "",
    name: r.name ?? "",
    email: r.email ?? "",
    amount: Number(r.amount) || 0,
    bookTitle: r.bookTitle ?? "",
    status,
    createdAt: Number(r.createdAt) || 0,
    paidAt: r.paidAt ? Number(r.paidAt) : undefined,
    memo: r.memo || undefined,
    source: r.source || undefined,
    referrer: r.referrer || undefined,
  };
}

export async function getOrder(id: string): Promise<Order | null> {
  if (!ID_RE.test(id)) return null;
  const [raw] = await pipeline([["HGETALL", KEY(id)]]);
  return parse(raw);
}

export async function setOrderStatus(
  id: string,
  status: OrderStatus,
  memo?: string,
): Promise<Order | null> {
  const order = await getOrder(id);
  if (!order) return null;
  const next: Order = {
    ...order,
    status,
    paidAt: status === "paid" ? (order.paidAt ?? Date.now()) : undefined,
    memo: memo ?? order.memo,
  };
  await writeOrder(next, false); // 상태 변경일 뿐이니 목록에 다시 올리지 않는다
  return next;
}

/**
 * 주문별 삽화 생성 카운터 — limit 이하면 1 올리고 true, 넘으면 false.
 * 결제한 주문의 토큰이 유출돼도 무제한으로 그리지 못하게 하는 상한.
 * 카운터는 주문과 같은 보관 기간으로 만료된다.
 */
export async function consumeOrderImage(id: string, limit: number): Promise<boolean> {
  const key = `${KEY(id)}:img`;
  const [count] = await pipeline([
    ["INCR", key],
    ["EXPIRE", key, RETENTION_DAYS * 24 * 60 * 60],
  ]);
  // 저장소가 없으면(pipeline이 빈 배열) 로컬 개발로 보고 통과시킨다
  if (count === undefined) return true;
  return Number(count) <= limit;
}

/** 주문 완전 삭제 — 테스트 주문 정리용. 기록과 목록에서 모두 지운다. */
export async function deleteOrder(id: string): Promise<boolean> {
  const order = await getOrder(id);
  if (!order) return false;
  await pipeline([
    ["DEL", KEY(id)],
    ["LREM", INDEX, 0, id],
  ]);
  return true;
}

/** 관리자용 목록 — 최신순. 만료돼 사라진 id는 건너뛴다. */
export async function listOrders(limit = 200): Promise<Order[]> {
  const [ids] = await pipeline([["LRANGE", INDEX, 0, limit - 1]]);
  const raw = Array.isArray(ids) ? (ids as string[]) : [];
  // 중복이 쌓였던 옛 기록도 한 번만 보이게 (최신 위치를 살린다)
  const list = [...new Set(raw)];
  if (list.length === 0) return [];
  const rows = await pipeline(list.map((id) => ["HGETALL", KEY(id)]));
  return rows.map(parse).filter((o): o is Order => o !== null);
}
