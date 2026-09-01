/**
 * 서비스가 조용히 멈추는 사고를 관리자에게 메일로 알린다.
 *
 * 같은 사고로 메일이 쏟아지면 아무도 안 읽게 되므로 한 시간에 한 통만 보낸다.
 * 알림 실패는 절대 손님 응답을 막지 않는다 — 전부 삼킨다.
 */
import { pipeline, restConfig } from "@/lib/kv";
import { mailAdminAlert } from "@/lib/mail";

const COOLDOWN_SEC = 60 * 60;

/** 저장소가 없을 때의 폴백 (인스턴스 메모리 — 배포 환경에선 인스턴스마다 따로 센다) */
const memory: Map<string, number> =
  (globalThis as { __kidsbookAlerts?: Map<string, number> }).__kidsbookAlerts ?? new Map();
(globalThis as { __kidsbookAlerts?: Map<string, number> }).__kidsbookAlerts = memory;

async function firstInWindow(key: string): Promise<boolean> {
  if (!restConfig()) {
    const now = Date.now();
    if (now - (memory.get(key) ?? 0) < COOLDOWN_SEC * 1000) return false;
    memory.set(key, now);
    return true;
  }
  // SET NX — 먼저 잡은 요청만 true. 동시에 여러 요청이 실패해도 메일은 한 통이다.
  const [res] = await pipeline([
    ["SET", `kidsbook:alert:${key}`, "1", "NX", "EX", COOLDOWN_SEC],
  ]);
  return res !== null;
}

export async function alertAdmin(key: string, subject: string, body: string): Promise<void> {
  try {
    if (!(await firstInWindow(key))) return;
    await mailAdminAlert(subject, body);
  } catch (err) {
    console.warn("admin alert failed:", err);
  }
}
