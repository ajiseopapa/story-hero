/**
 * 무료 쿠폰.
 *
 * 지인·체험단·이벤트에 책 한 권을 무료로 열어주기 위한 코드.
 *
 * ⭐ 쿠폰을 쓰면 **0원짜리 '입금 확인된 주문'**이 하나 생긴다(app/api/coupon).
 *    결제한 사람과 똑같은 길을 타야 남은 삽화 생성·PDF·보관 링크가 그대로 열리고,
 *    주문 목록에도 흔적이 남아 몇 권이 공짜로 나갔는지 셀 수 있다.
 */
import { pipeline, restConfig, toRecord } from "@/lib/kv";

const KEY = (code: string) => `kidsbook:coupon:${code}`;
const INDEX = "kidsbook:coupons";
const RETENTION_DAYS = 400;

export interface Coupon {
  code: string;
  maxUses: number;
  used: number;
  memo?: string;
  /** 없으면 무기한 */
  expiresAt?: number;
  createdAt: number;
}

export const CODE_RE = /^[A-Z0-9]{4,20}$/;

/** 손으로 옮겨 적는 값이라 공백·하이픈·대소문자를 다 흡수한다 (kids-1234 → KIDS1234) */
export function normalizeCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
}

/** 헷갈리는 글자(0·O·1·I)를 뺀 코드. 문자로 불러줄 일이 있어서다. */
export function randomCode(prefix = "KIDS", len = 5): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return normalizeCode(prefix + out);
}

function parse(raw: unknown): Coupon | null {
  const r = toRecord(raw);
  if (!r.code) return null;
  return {
    code: r.code,
    maxUses: Number(r.maxUses) || 0,
    used: Number(r.used) || 0,
    memo: r.memo || undefined,
    expiresAt: r.expiresAt ? Number(r.expiresAt) : undefined,
    createdAt: Number(r.createdAt) || 0,
  };
}

export async function getCoupon(code: string): Promise<Coupon | null> {
  if (!CODE_RE.test(code)) return null;
  const [raw] = await pipeline([["HGETALL", KEY(code)]]);
  return parse(raw);
}

/** 새 쿠폰 발급. 같은 코드가 이미 있으면 만들지 않는다(사용 횟수가 초기화되면 안 된다). */
export async function createCoupon(c: {
  code: string;
  maxUses: number;
  memo?: string;
  expiresAt?: number;
}): Promise<Coupon | null> {
  if (!CODE_RE.test(c.code)) return null;
  if (await getCoupon(c.code)) return null;
  const coupon: Coupon = {
    code: c.code,
    maxUses: Math.min(Math.max(Math.round(c.maxUses) || 1, 1), 1000),
    used: 0,
    memo: c.memo,
    expiresAt: c.expiresAt,
    createdAt: Date.now(),
  };
  await pipeline([
    [
      "HSET",
      KEY(coupon.code),
      "code",
      coupon.code,
      "maxUses",
      coupon.maxUses,
      "used",
      0,
      "createdAt",
      coupon.createdAt,
      ...(coupon.memo ? ["memo", coupon.memo] : []),
      ...(coupon.expiresAt ? ["expiresAt", coupon.expiresAt] : []),
    ],
    ["EXPIRE", KEY(coupon.code), RETENTION_DAYS * 24 * 60 * 60],
    ["LPUSH", INDEX, coupon.code],
    ["LTRIM", INDEX, 0, 499],
  ]);
  return coupon;
}

export interface CouponPatch {
  maxUses?: number;
  /** null이면 지운다 */
  memo?: string | null;
  /** null이면 무기한으로 */
  expiresAt?: number | null;
}

/**
 * 발급한 쿠폰 고치기 — 횟수·메모·만료일만. 코드와 사용 횟수는 못 바꾼다.
 * 지웠다 다시 만들면 사용 횟수가 0으로 돌아가 버려서 따로 둔 함수다.
 */
export async function updateCoupon(code: string, patch: CouponPatch): Promise<Coupon | null> {
  const coupon = await getCoupon(code);
  if (!coupon) return null;

  const sets: (string | number)[] = [];
  const dels: string[] = [];

  if (patch.maxUses !== undefined) {
    coupon.maxUses = Math.min(Math.max(Math.round(patch.maxUses) || 1, 1), 1000);
    sets.push("maxUses", coupon.maxUses);
  }
  if (patch.memo !== undefined) {
    const memo = patch.memo?.trim().slice(0, 60) || "";
    coupon.memo = memo || undefined;
    if (memo) sets.push("memo", memo);
    else dels.push("memo");
  }
  if (patch.expiresAt !== undefined) {
    const at = patch.expiresAt && Number.isFinite(patch.expiresAt) ? patch.expiresAt : undefined;
    coupon.expiresAt = at;
    if (at) sets.push("expiresAt", at);
    else dels.push("expiresAt");
  }

  const cmds: (string | number)[][] = [];
  if (sets.length) cmds.push(["HSET", KEY(code), ...sets]);
  if (dels.length) cmds.push(["HDEL", KEY(code), ...dels]);
  if (cmds.length) await pipeline(cmds);
  return coupon;
}

export async function deleteCoupon(code: string): Promise<boolean> {
  if (!(await getCoupon(code))) return false;
  await pipeline([
    ["DEL", KEY(code)],
    ["LREM", INDEX, 0, code],
  ]);
  return true;
}

export async function listCoupons(limit = 200): Promise<Coupon[]> {
  const [ids] = await pipeline([["LRANGE", INDEX, 0, limit - 1]]);
  const codes = [...new Set(Array.isArray(ids) ? (ids as string[]) : [])];
  if (codes.length === 0) return [];
  const rows = await pipeline(codes.map((c) => ["HGETALL", KEY(c)]));
  return rows.map(parse).filter((c): c is Coupon => c !== null);
}

export type RedeemResult =
  | { ok: true; coupon: Coupon }
  | { ok: false; reason: "notfound" | "expired" | "used" };

/** 쿠폰이 막힌 이유를 손님 말로. /api/coupon과 /api/story가 같은 문장을 쓴다. */
export function couponFailMessage(reason: "notfound" | "expired" | "used"): string {
  return reason === "expired"
    ? "기간이 지난 쿠폰이에요."
    : reason === "used"
      ? "이미 모두 사용된 쿠폰이에요."
      : "그런 쿠폰이 없어요. 코드를 다시 확인해주세요.";
}

/**
 * 쓰지 않고 확인만 — "지금 이 쿠폰으로 책을 열 수 있는가".
 *
 * 무료 샘플 단계에서 쓴다. 쿠폰이 있는 손님이 기기당 하루 3회 샘플 한도에 걸려
 * 쿠폰을 넣을 화면(결제 창)까지 가지도 못했다(2026-09-05). 샘플 단계에서는 깎지 않고
 * 확인만 하고, 실제 차감은 책을 열 때(/api/coupon) 그대로 한다.
 */
export async function checkCoupon(code: string): Promise<RedeemResult> {
  const coupon = await getCoupon(code);
  if (!coupon) return { ok: false, reason: "notfound" };
  if (coupon.expiresAt && Date.now() > coupon.expiresAt) return { ok: false, reason: "expired" };
  if (coupon.used >= coupon.maxUses) return { ok: false, reason: "used" };
  return { ok: true, coupon };
}

/**
 * 쿠폰 한 장 쓰기.
 *
 * 먼저 올리고 넘치면 되돌린다 — 읽고-비교하고-쓰면 두 사람이 같은 순간에 마지막 한 장을
 * 나눠 쓸 수 있다. HINCRBY는 원자적이라 그런 일이 없다.
 */
export async function redeemCoupon(code: string): Promise<RedeemResult> {
  const coupon = await getCoupon(code);
  if (!coupon) return { ok: false, reason: "notfound" };
  if (coupon.expiresAt && Date.now() > coupon.expiresAt) return { ok: false, reason: "expired" };
  if (!restConfig()) return { ok: true, coupon }; // 저장소 없는 로컬 개발

  const [raw] = await pipeline([["HINCRBY", KEY(code), "used", 1]]);
  const used = Number(raw);
  if (used > coupon.maxUses) {
    await pipeline([["HINCRBY", KEY(code), "used", -1]]);
    return { ok: false, reason: "used" };
  }
  return { ok: true, coupon: { ...coupon, used } };
}
