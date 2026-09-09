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

/** 인스턴스 메모리로 재는 쿨다운 — 저장소가 없거나 죽었을 때의 폴백 */
function firstInMemory(key: string): boolean {
  const now = Date.now();
  if (now - (memory.get(key) ?? 0) < COOLDOWN_SEC * 1000) return false;
  memory.set(key, now);
  return true;
}

async function firstInWindow(key: string): Promise<boolean> {
  if (restConfig()) {
    try {
      // SET NX — 먼저 잡은 요청만 true. 동시에 여러 요청이 실패해도 메일은 한 통이다.
      const [res] = await pipeline([
        ["SET", `kidsbook:alert:${key}`, "1", "NX", "EX", COOLDOWN_SEC],
      ]);
      return res !== null;
    } catch (err) {
      // 쿨다운을 KV로 재는데, 정작 KV가 죽어서 생긴 사고를 알리려 할 때 여기서 같이 넘어진다.
      // 알림이 가장 필요한 순간에 침묵하는 셈이라 인스턴스 메모리로 물러선다 — 인스턴스 수만큼
      // 메일이 겹칠 수 있지만, 몇 통 겹치는 편이 한 통도 못 받는 것보다 낫다.
      console.warn("alert dedup via KV failed, falling back to memory:", err);
    }
  }
  return firstInMemory(key);
}

export async function alertAdmin(key: string, subject: string, body: string): Promise<void> {
  try {
    if (!(await firstInWindow(key))) return;
    await mailAdminAlert(subject, body);
  } catch (err) {
    console.warn("admin alert failed:", err);
  }
}
