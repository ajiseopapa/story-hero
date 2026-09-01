"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { SAMPLE_H, SAMPLE_W } from "@/lib/samples";
import {
  ART_STYLES,
  DEFAULT_ART,
  DEFAULT_THEME,
  MAX_CHILDREN,
  THEMES,
  joinCallNames,
  type ThemeId,
} from "@/lib/prompts";
import { BUSINESS } from "@/lib/business";
import { SITE_ORIGIN } from "@/lib/sharebook";
import PrintRequestForm from "./print-request-form";
import { useConfirm } from "./confirm-dialog";
import { downloadStoryPdf } from "@/lib/pdf";
import { blobToDataUrl, downloadSoundBook } from "@/lib/soundbook";
import { createShareLink, deleteShareLink, newShareId } from "@/lib/sharebook-client";
import { CONSENT_VERSION, REQUIRED_CONSENT_IDS } from "@/lib/consent";
import { trackEvery, trackStep } from "@/lib/track";
import { postLong, ramp } from "@/lib/long-fetch";
import PhotoGuide from "./photo-guide";
import BankOrderBox, {
  checkBankOrderPaid,
  clearBankOrder,
  loadBankOrder,
  type BankOrder,
} from "./bank-order";
import ConsentBox from "./consent-box";
import PhotoCropper from "./photo-cropper";
import ReviewForm from "./review-form";
import ReviewsSection from "./reviews-section";
import { kvDel, kvGet, kvSet } from "@/lib/store";

type Gender = "girl" | "boy";
type Phase = "form" | "generating" | "book";

type Scene = { text: string; imagePrompt: string };
type StoryData = {
  title: string;
  cover: { imagePrompt: string };
  scenes: Scene[];
};

type BookPage = {
  kind: "cover" | "scene";
  text: string; // 표지는 제목, 장면은 본문
  imagePrompt: string;
  image: string | null; // data URL
};

// 만들어 둔 공유 링크 (IndexedDB "shares" 목록에 보관 — deleteKey가 있어야 나중에 지울 수 있다)
type SavedShare = { id: string; url: string; deleteKey: string; title: string; createdAt: number };

async function loadShares(): Promise<SavedShare[]> {
  return (await kvGet<SavedShare[]>("shares")) ?? [];
}

async function addShare(share: SavedShare): Promise<void> {
  await kvSet("shares", [...(await loadShares()), share]);
}

async function dropShare(id: string): Promise<void> {
  await kvSet(
    "shares",
    (await loadShares()).filter((s) => s.id !== id),
  );
}

// 폼에서 편집하는 아이 한 명 (형제·자매 최대 MAX_CHILDREN명)
type ChildForm = {
  name: string;
  gender: Gender | null;
  age: number;
  photo: string | null; // data URL
};

const emptyChild = (): ChildForm => ({ name: "", gender: null, age: 6, photo: null });

// 결제 리다이렉트를 건너 복원할 초안 상태
type Draft = {
  title: string;
  photo?: string; // 구버전 단일 사진 초안 호환
  pages: BookPage[];
  current: number;
  age?: number; // 구버전 (children 없을 때만 사용)
  gender?: Gender;
  // 신버전: 아이별 정보 (photos[i] ↔ children[i])
  photos?: string[];
  children?: { name: string; age: number; gender: Gender }[];
  art?: string; // 그림체 (예전 초안엔 없음 → 수채화)
};

// 초안(신·구버전)에서 아이 배열 복원
function draftToKids(draft: Draft): ChildForm[] {
  if (draft.children && draft.children.length > 0 && draft.photos) {
    return draft.children.map((c, i) => ({
      name: c.name,
      gender: c.gender,
      age: c.age,
      photo: draft.photos?.[i] ?? null,
    }));
  }
  return [
    {
      name: "",
      gender: draft.gender ?? "girl",
      age: draft.age ?? 6,
      photo: draft.photo ?? null,
    },
  ];
}

const FREE_SCENES = 1; // 무료 샘플: 표지 + 1장면 (샘플 원가 절감)
const TOTAL_PAGES = 11; // 표지 1 + 장면 10 — 화면 곳곳에 적는 "11페이지"의 근거
const PRICE = Number(process.env.NEXT_PUBLIC_PRICE ?? "14900");
// 결제 방식. 토스 카드결제를 열기 전까지는 계좌이체로 받는다.
// 라이브 키를 넣으면 NEXT_PUBLIC_PAY_MODE=card 로 바꾸면 된다.
const PAY_MODE = process.env.NEXT_PUBLIC_PAY_MODE === "card" ? "card" : "bank";
const LIST_PRICE = 24900; // 앵커링용 정가 표시

// ----- 읽어주기 목소리 -----
type VoiceMode = "ai" | "mine"; // 샘플 목소리 / 직접 녹음 (추후 "clone" AI 복제 추가 여지)
type NarratorId = "grandpa" | "grandma" | "dad" | "mom";
const NARRATOR_LIST: { id: NarratorId; emoji: string; label: string }[] = [
  { id: "grandpa", emoji: "👴", label: "할아버지" },
  { id: "grandma", emoji: "👵", label: "할머니" },
  { id: "dad", emoji: "👨", label: "아빠" },
  { id: "mom", emoji: "👩", label: "엄마" },
];

// 업로드 사진을 최대 변으로 다운스케일하여 data URL(jpeg)로 반환
async function fileToScaledDataUrl(file: File, maxSide = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없어요.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// 결제 표식. 예전엔 문자열("bank", 토스 orderId)만 저장했는데, 지금은 서버가 검증할 수 있는
// 주문 자격 증명({id, token})을 저장한다 — /api/image가 이걸로 "돈 낸 주문"을 확인한다.
// 옛 문자열 표식도 계속 읽혀야 하므로 둘 다 허용한다.
type PaidMark = string | { id: string; token: string };

function paidMarkToOrder(mark: PaidMark | null | undefined): { id: string; token: string } | undefined {
  return mark && typeof mark === "object" && mark.id && mark.token
    ? { id: mark.id, token: mark.token }
    : undefined;
}

// data URL(jpeg) 재압축 — 요청 본문이 서버 한도를 넘지 않게 줄일 때 사용
async function recompressDataUrl(
  dataUrl: string,
  quality: number,
  maxSide: number,
): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

// 사진 합계가 예산을 넘으면 단계적으로 재압축한다.
// 아이 3명 × 고화질 크롭이면 Vercel 함수 요청 한도(4.5MB)를 넘을 수 있고,
// 넘으면 JSON 아닌 413이 와서 "서버 응답이 지연됐어요"만 반복되는 수수께끼 실패가 된다.
const PHOTO_BUDGET = 3_400_000; // base64 문자 수 ≈ 전송 바이트. 프롬프트·JSON 여유분을 뺀 예산
async function fitPhotosToBudget(photos: string[]): Promise<string[]> {
  const steps: [number, number][] = [
    [0.8, 1536],
    [0.65, 1280],
    [0.55, 1024],
  ];
  let cur = photos;
  for (const [quality, maxSide] of steps) {
    if (cur.reduce((n, p) => n + p.length, 0) <= PHOTO_BUDGET) return cur;
    cur = await Promise.all(cur.map((p) => recompressDataUrl(p, quality, maxSide)));
  }
  return cur;
}

// Vercel 타임아웃/오류 시 JSON이 아닌 텍스트("An error occurred...")가 오므로
// 그대로 res.json() 하면 파싱 에러가 사용자에게 노출됨 — 안전하게 감싼다.
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "서버 응답이 지연됐어요. 잠시 후 다시 시도해주세요." +
        (res.status ? ` (오류 코드 ${res.status})` : ""),
    );
  }
}

async function fetchImage(
  photos: string[],
  imagePrompt: string,
  kind: "cover" | "scene",
  children: { age: number; gender: Gender }[],
  art: string,
  order?: { id: string; token: string }, // 결제한 주문이면 서버가 IP 한도 대신 주문 한도를 쓴다
): Promise<string> {
  const res = await postLong(
    "/api/image",
    {
      photos: await fitPhotosToBudget(photos),
      imagePrompt,
      kind,
      children,
      art,
      order,
    },
    150_000,
  );
  const json = await safeJson(res);
  if (!res.ok) throw new Error((json.error as string) || "삽화 생성 실패");
  return json.image as string;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("form");
  const [kids, setKids] = useState<ChildForm[]>([emptyChild()]);
  // 기본 주제·그림체를 미리 골라둔다 — 안 고른 사람도 바로 무료 샘플을 만들 수 있어야 한다.
  const [theme, setTheme] = useState<ThemeId | null>(DEFAULT_THEME);
  const [art, setArt] = useState<string>(DEFAULT_ART); // 그림체
  const [error, setError] = useState<string | null>(null);

  const [progressStep, setProgressStep] = useState("");
  const [progressPct, setProgressPct] = useState(0);

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<BookPage[]>([]);
  const [current, setCurrent] = useState(0);
  const [paid, setPaid] = useState(false);
  // 이번 세션에 만든 책이 아니라 '이어서 보기'·결제 복귀로 연 책인가 — 구매 클릭을 갈라 센다
  const [resumed, setResumed] = useState(false);
  const [unlocking, setUnlocking] = useState(false); // 결제 후 나머지 생성 중
  // 이 브라우저에 저장된 지난 동화 — 자동으로 펼치지 않고 첫 화면에 "이어보기" 카드로만 안내
  const [saved, setSaved] = useState<{ draft: Draft; paid: boolean } | null>(null);
  const { confirmDialog, ask } = useConfirm();

  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  const restoredRef = useRef(false);
  const [dragOver, setDragOver] = useState<number | null>(null); // 드래그 중인 아이 카드 index
  const [cropping, setCropping] = useState<{ idx: number; src: string } | null>(null);
  const [showBank, setShowBank] = useState(false); // 계좌이체 주문 창

  // 법정 동의 (아동·민감정보·국외이전). 한 번 동의하면 이 브라우저에 기록해 다시 묻지 않는다.
  const [consents, setConsents] = useState<string[]>([]);
  const consentDone = REQUIRED_CONSENT_IDS.every((id) => consents.includes(id));

  useEffect(() => {
    kvGet<{ version: string; ids: string[] }>("consent").then((saved) => {
      if (saved?.version === CONSENT_VERSION) setConsents(saved.ids);
    });
  }, []);

  // 퍼널 시작점. 세션당 한 번만 집계된다(lib/track.ts).
  useEffect(() => {
    trackStep("visit");
  }, []);

  /**
   * 테스트 통행증이 이 브라우저에 붙어 있는지 화면에 보여준다.
   *
   * 통행증은 쿠키라 브라우저마다 따로다. 링크를 크롬에서 열고 인스타 인앱에서 확인하면
   * 조용히 평소 한도에 걸린다 — 왜 막혔는지 알 수 없었다(2026-09-01).
   */
  const [testPass, setTestPass] = useState<"on" | "off" | null>(null);
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).has("test");
    let muted = false;
    try {
      muted = localStorage.getItem("kidsbook:notrack") === "1";
    } catch {
      /* 저장소가 막혔으면 주소로 들어온 경우만 확인한다 */
    }
    if (!asked && !muted) return; // 손님에게는 아무것도 묻지 않는다
    fetch("/api/test-pass?check=1")
      .then((r) => r.json())
      .then((d: { active?: boolean }) => setTestPass(d.active ? "on" : "off"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (consentDone) {
      kvSet("consent", { version: CONSENT_VERSION, ids: consents, at: new Date().toISOString() });
    }
  }, [consentDone, consents]);

  const canSubmit =
    theme !== null &&
    consentDone &&
    kids.length > 0 &&
    kids.every((k) => k.name.trim().length > 0 && k.gender !== null && k.photo !== null);

  const patchKid = useCallback((idx: number, patch: Partial<ChildForm>) => {
    setKids((prev) => prev.map((k, i) => (i === idx ? { ...k, ...patch } : k)));
  }, []);

  // 저장된 동화를 화면에 펼친다 (결제 복귀 / 이어보기 공통)
  //
  // ⭐ 이 길로 열린 책에서 누른 구매는 pay:click이 아니라 pay:click:resume으로 센다.
  //    이번 세션에 샘플을 만든 적이 없는 사람이라, 퍼널의 "샘플 완성 → 구매 의사"에
  //    섞이면 전환율이 200%를 넘는 숫자가 나온다 (2026-08-30에 실제로 그랬다).
  const openDraft = useCallback((draft: Draft, isPaid: boolean) => {
    setTitle(draft.title);
    setArt(draft.art ?? "watercolor"); // 예전 초안은 수채화로 그렸다
    setKids(draftToKids(draft));
    setPages(draft.pages);
    setCurrent(Math.min(draft.current, draft.pages.length - 1));
    setPaid(isPaid);
    setSaved(null);
    setResumed(true);
    setPhase("book");
  }, []);

  // ----- 결제 리다이렉트 후 복원 -----
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      const draft = await kvGet<Draft>("draft");
      if (!draft) return;
      let paidOrder = await kvGet<PaidMark>("paidOrder");

      // 계좌이체로 주문해둔 게 있으면 그새 입금 확인이 됐는지 물어본다.
      // 카드 결제와 같은 표식(paidOrder)으로 바꿔 두면 아래 흐름이 그대로 재사용된다.
      // 표식을 옮긴 뒤 주문 기록은 지운다 — 남겨두면 다음에 만든 새 동화까지 열려버린다.
      if (!paidOrder) {
        const bank = await loadBankOrder();
        if (bank && (await checkBankOrderPaid(bank))) {
          // id+token을 그대로 옮겨야 /api/image가 "돈 낸 주문"으로 검증할 수 있다
          paidOrder = { id: bank.id, token: bank.token };
          await kvSet("paidOrder", paidOrder);
          await clearBankOrder();
        }
      }

      const q = new URLSearchParams(window.location.search);
      const fromPay = q.has("paid") || q.has("resume");
      if (fromPay) window.history.replaceState(null, "", "/");

      // 결제한 책인데 삽화가 덜 그려졌으면(생성 중 이탈) 바로 열어서 이어 그린다.
      const unfinished = !!paidOrder && draft.pages.some((p) => !p.image);

      // 그냥 다시 들어온 경우엔 지난 동화를 자동으로 펼치지 않는다.
      // (첫 화면은 언제나 "새로 만들기" — 지난 동화는 카드로 안내)
      if (!fromPay && !unfinished) {
        setSaved({ draft, paid: !!paidOrder });
        return;
      }

      openDraft(draft, !!paidOrder);
      if (paidOrder) await resumeGeneration(draft);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 결제 후 아직 안 그려진 장면들을 이어서 생성.
  // 자동 폴링과 수동 확인 버튼이 입금을 동시에 감지하면 두 번 불릴 수 있어서,
  // ref로 재진입을 막는다 — 안 막으면 같은 장면들을 두 벌 그려 비용이 2배로 나간다.
  const resumingRef = useRef(false);
  const resumeGeneration = useCallback(async (draft: Draft) => {
    if (resumingRef.current) return;
    const missing = draft.pages
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.image);
    if (missing.length === 0) return;
    const drawKids = draftToKids(draft);
    const photos = drawKids.map((k) => k.photo).filter((p): p is string => !!p);
    const specs = drawKids.map((k) => ({ age: k.age, gender: k.gender ?? ("girl" as Gender) }));
    if (photos.length === 0) return;
    resumingRef.current = true;
    setUnlocking(true);
    try {
      // 결제한 주문의 자격 증명 — 서버가 이걸로 무료 IP 한도 대신 주문 한도를 적용한다
      const order = paidMarkToOrder(await kvGet<PaidMark>("paidOrder"));
      let cur = draft.pages;
      for (const { p, i } of missing) {
        // 결제 전에 그리던 그림체를 그대로 이어간다 (예전 초안엔 값이 없어 수채화)
        const img = await fetchImage(photos, p.imagePrompt, p.kind, specs, draft.art ?? "", order);
        cur = cur.map((pg, j) => (j === i ? { ...pg, image: img } : pg));
        setPages(cur);
        await kvSet("draft", { ...draft, pages: cur });
      }
    } catch {
      setError("남은 삽화를 그리다 오류가 났어요. 새로고침하면 이어서 그립니다.");
    } finally {
      setUnlocking(false);
      resumingRef.current = false;
    }
  }, []);

  // 파일 선택창을 여는 유일한 통로. 여기와 handleFile 사이가 인앱 브라우저에서 끊기는 구간이라
  // 두 지점을 따로 센다 — 안 그러면 "관심이 없어서 안 올렸다"와 "브라우저가 막았다"가 구별되지 않는다.
  const openPicker = useCallback((idx: number) => {
    trackStep("photo:open");
    fileRefs.current[idx]?.click();
  }, []);

  // 고른 사진은 바로 쓰지 않고 자르기 화면을 먼저 띄운다 (얼굴 비율이 닮음을 좌우)
  const handleFile = useCallback(async (idx: number, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일을 올려주세요.");
      return;
    }
    trackStep("photo:pick"); // 선택창을 연 사람 중 몇 %가 여기까지 오는가 — 인앱 브라우저 진단선
    try {
      setError(null);
      const dataUrl = await fileToScaledDataUrl(file, 1600); // 자르기 화면용 원본
      setCropping({ idx, src: dataUrl });
    } catch {
      setError("사진을 불러오지 못했어요. 다른 사진을 시도해주세요.");
    }
  }, []);

  // ----- 샘플 생성 (표지 + FREE_SCENES 장면) -----
  // 모바일 더블탭으로 두 번 실행되면 이야기·삽화를 두 벌 생성한다(비용·쿼터 2배) — ref로 막는다
  const startingRef = useRef(false);
  const start = useCallback(async () => {
    if (!canSubmit || startingRef.current) return;
    startingRef.current = true;
    try {
      // 기기에는 한 권만 저장된다 — 새 책을 만들면 지난 책이 지워지므로,
      // 실수로 (특히 결제한) 책을 날리지 않게 한 번 확인한다. 공유 링크가 보관 수단이다.
      if (saved) {
        const ok = await ask({
          title: "지난 동화가 지워져요 📖",
          message: saved.paid
            ? `《 ${saved.draft.title} 》는 결제하신 책이에요!\n지우기 전에 '이어서 보기'로 열어 공유 링크를 만들어두면 1년간 보관됩니다.`
            : `《 ${saved.draft.title} 》를 보관하고 싶다면\n'이어서 보기'로 열어 공유 링크를 만들어두세요.`,
          confirmLabel: "새로 만들기",
          cancelLabel: "취소",
        });
        if (!ok) return;
      }
      // 입금 확인을 기다리는 계좌이체 주문이 있으면 경고한다 — 새 샘플이 기존 초안을
      // 덮어써서, 입금해도 엉뚱한 책이 열리거나 주문한 책이 사라지는 사고를 막는다.
      const pendingBank = await loadBankOrder();
      if (pendingBank) {
        const ok = await ask({
          title: "입금 확인을 기다리는 주문이 있어요",
          message:
            `주문번호 ${pendingBank.orderNo} — 새 동화를 만들면 주문하신 동화가 지워지고,\n` +
            "입금하셔도 열 수 없게 돼요.",
          confirmLabel: "새로 만들기",
          cancelLabel: "취소",
        });
        if (!ok) return;
        await clearBankOrder();
      }
      await startInner();
    } finally {
      startingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, saved, ask, kids, theme, art]);

  const startInner = useCallback(async () => {
    const children = kids.map((k) => ({
      name: k.name.trim(),
      gender: k.gender as Gender,
      age: k.age,
    }));
    const photos = kids.map((k) => k.photo as string);
    setError(null);
    trackStep("sample:start");
    // 그림체·주제·아이 수는 고를 때마다 센다(퍼널 전환율 계산에는 안 씀)
    trackEvery(`art:${art}`, `theme:${theme}`, `kids:${kids.length}`);
    setPhase("generating");
    setProgressStep("이야기를 짓고 있어요… 1분쯤 걸려요");
    // 이야기 구간은 서버가 진행을 알려주지 않는다 — 시간으로 채운다(4 → 45%)
    let stopRamp = ramp(setProgressPct, 4, 45, 80);

    try {
      const storyRes = await postLong("/api/story", { children, theme }, 180_000);
      const story = (await safeJson(storyRes)) as unknown as StoryData & { error?: string };
      if (!storyRes.ok) throw new Error(story.error || "이야기 생성 실패");

      const skeleton: BookPage[] = [
        {
          kind: "cover",
          text: story.title,
          imagePrompt: story.cover.imagePrompt,
          image: null,
        },
        ...story.scenes.map((s) => ({
          kind: "scene" as const,
          text: s.text,
          imagePrompt: s.imagePrompt,
          image: null,
        })),
      ];
      setTitle(story.title);
      setPages(skeleton);

      // 무료 범위만 생성: 표지(0) + 장면 1..FREE_SCENES
      const freeCount = FREE_SCENES + 1;
      let cur = skeleton;
      stopRamp();
      for (let i = 0; i < freeCount; i++) {
        setProgressStep(
          i === 0 ? "표지 삽화를 그리고 있어요…" : `샘플 ${i} / ${FREE_SCENES} 장면을 그리고 있어요…`,
        );
        // 남은 55%를 삽화 장수로 나눠, 한 장 그리는 동안에도 막대가 움직이게 한다
        const base = 45 + (i * 55) / freeCount;
        const next = 45 + ((i + 1) * 55) / freeCount;
        stopRamp = ramp(setProgressPct, base, next, 55);
        const img = await fetchImage(photos, cur[i].imagePrompt, cur[i].kind, children, art);
        stopRamp();
        cur = cur.map((pg, j) => (j === i ? { ...pg, image: img } : pg));
        setPages(cur);
        setProgressPct(Math.round(next));
      }

      // 새 책이므로 이전 결제 기록·녹음 제거 후 초안 저장
      await kvDel("paidOrder");
      await kvDel("recordings");
      setPaid(false);
      await kvSet("draft", {
        title: story.title,
        pages: cur,
        current: 0,
        photos,
        children,
        art,
      } satisfies Draft);

      setCurrent(0);
      setResumed(false); // 이번 세션에 직접 만든 책이다
      setPhase("book");
      trackStep("sample:done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "문제가 발생했어요. 다시 시도해주세요.");
      setPhase("form");
      trackEvery("sample:fail"); // 실패는 매번 센다 — 재시도 횟수까지 알아야 원인이 보인다
    } finally {
      stopRamp(); // 성공·실패 어느 쪽이든 타이머가 남으면 안 된다
    }
  }, [canSubmit, kids, theme, art, saved, ask]);

  // ----- 결제 -----
  const pay = useCallback(async () => {
    // 구매 의사는 결제창이 뜨기 전에 센다 — 결제 설정이 없어도 "사려고 했다"는 사실은 남아야 한다.
    // 이어보기·결제 복귀로 연 책이면 따로 센다(lib/stats.ts의 EXTRA 참고).
    trackStep(resumed ? "pay:click:resume" : "pay:click");

    // 계좌이체 기간에는 토스를 부르지 않고 주문 창을 연다.
    // 이 경우 리다이렉트가 없으므로 초안을 미리 저장할 필요도 없다.
    if (PAY_MODE === "bank") {
      setError(null);
      setShowBank(true);
      return;
    }

    try {
      setError(null);
      // 리다이렉트 전에 현재 상태 저장
      await kvSet("draft", {
        title,
        pages,
        current,
        photos: kids.map((k) => k.photo).filter((p): p is string => !!p),
        children: kids.map((k) => ({
          name: k.name.trim(),
          gender: k.gender ?? ("girl" as Gender),
          age: k.age,
        })),
        // 그림체를 빠뜨리면 결제 후 이어그리는 장면이 기본값(수채화)으로 그려져
        // 앞뒤 그림체가 다른 책이 나온다 — 반드시 함께 저장한다.
        art,
      } satisfies Draft);

      const { loadTossPayments, ANONYMOUS } = await import(
        "@tosspayments/tosspayments-sdk"
      );
      const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
      if (!clientKey) throw new Error("결제 설정이 없습니다.");
      const toss = await loadTossPayments(clientKey);
      const payment = toss.payment({ customerKey: ANONYMOUS });
      const orderId = `story-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: PRICE },
        orderId,
        orderName: `${title} 그림동화책`,
        successUrl: `${window.location.origin}/pay/success`,
        failUrl: `${window.location.origin}/pay/fail`,
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "USER_CANCEL") return; // 사용자가 결제창을 닫음
      setError(e?.message || "결제 연결 중 오류가 발생했습니다.");
    }
  }, [title, pages, current, kids, art, resumed]);

  // 계좌이체 입금이 확인됐을 때 — 카드 결제 성공과 같은 자리로 합류시킨다.
  const unlockAfterBankPay = useCallback(
    async (bank: BankOrder) => {
      setShowBank(false);
      setPaid(true);
      const draft: Draft = {
        title,
        pages,
        current,
        photos: kids.map((k) => k.photo).filter((p): p is string => !!p),
        children: kids.map((k) => ({
          name: k.name.trim(),
          gender: k.gender ?? ("girl" as Gender),
          age: k.age,
        })),
        art,
      };
      await kvSet("draft", draft);
      // id+token을 남겨야 /api/image가 "돈 낸 주문"으로 검증해서 이어 그릴 수 있다
      await kvSet("paidOrder", { id: bank.id, token: bank.token });
      // 주문 기록은 여기서 지운다 — 남겨두면 다음에 만드는 새 동화까지 공짜로 열린다
      await clearBankOrder();
      await resumeGeneration(draft);
    },
    [title, pages, current, kids, art, resumeGeneration],
  );

  const reset = useCallback(async () => {
    // 결제한 책은 실수로 한 번 누르면 이 기기에서 사라지므로 묻는다.
    // (보관·공유 링크를 만들어뒀다면 링크로는 계속 열 수 있다)
    if (paid && pages.length > 0) {
      const ok = await ask({
        title: "결제하신 동화가 지워져요",
        message:
          "이 기기에서 지워지면 되돌릴 수 없어요.\n" +
          "PDF 저장이나 보관·공유 링크를 아직 안 만드셨다면 먼저 만들어두세요.",
        confirmLabel: "지우고 만들기",
        cancelLabel: "취소",
      });
      if (!ok) return;
    }
    setPhase("form");
    setKids([emptyChild()]);
    setTheme(null);
    setPages([]);
    setTitle("");
    setCurrent(0);
    setPaid(false);
    setSaved(null);
    setProgressPct(0);
    setProgressStep("");
    setError(null);
    window.scrollTo({ top: 0 });
    kvDel("draft");
    kvDel("paidOrder");
    kvDel("recordings");
    // 새 동화를 만들면 지난 계좌이체 주문도 털어낸다 — 그 주문이 이 책을 열어주면 안 된다
    void clearBankOrder();
    // 공유 링크 목록("shares")은 지우지 않는다 — 새 동화를 만들어도 지난 링크를 지울 수 있어야 한다
  }, [paid, pages.length, ask]);

  // 첫 화면의 "지난 동화" 카드 지우기 — 저장된 초안·결제기록·녹음을 함께 정리한다.
  const dropSaved = useCallback(async () => {
    const ok = await ask({
      title: "지난 동화를 지울까요?",
      message: "이 기기에서는 다시 열 수 없어요.",
      confirmLabel: "지우기",
    });
    if (!ok) return;
    setSaved(null);
    kvDel("draft");
    kvDel("paidOrder");
    kvDel("recordings");
  }, [ask]);

  return (
    <main className="wrap">
      {/* 검색결과에 상품(가격) 정보로 노출되기 위한 구조화 데이터.
          클라이언트 컴포넌트여도 프리렌더된 HTML에 포함되므로 봇이 읽을 수 있다. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: "키즈북 · 우리 아이가 주인공인 맞춤 그림동화책",
            description:
              "아이 이름과 사진으로 만드는 표지 포함 11페이지 맞춤 그림동화책. 사실적 그림·수채화·색연필·크레파스 4가지 그림체 지원.",
            image: `${SITE_ORIGIN}/opengraph-image`,
            brand: { "@type": "Brand", name: "키즈북" },
            offers: {
              "@type": "Offer",
              url: SITE_ORIGIN,
              price: PRICE,
              priceCurrency: "KRW",
              availability: "https://schema.org/InStock",
            },
          }),
        }}
      />
      <header className="hero">
        <span className="badge">키즈북 ✨</span>
        <h1>
          우리 아이가
          <br />
          주인공이 되는 그림동화
        </h1>
        <p>
          아이 사진 한 장으로, <b>우리 아이를 닮은 주인공</b>이 등장하는{" "}
          <b>표지 포함 11페이지</b> 그림동화를 만들어요.
          <br />
          <b>표지와 첫 장면은 무료</b>로 먼저 보여드려요 — 마음에 들 때만 결제하시면 됩니다.
        </p>
        <p className="hero-nosignup">회원가입 없이 바로 만들어요</p>
        <ul className="hero-points">
          <li>
            <span className="hp-emoji">👀</span>
            결제 전<br />
            결과 확인
          </li>
          <li>
            <span className="hp-emoji">🔊</span>
            엄마·아빠 목소리로
            <br />
            읽어주기
          </li>
          <li>
            <span className="hp-emoji">💬</span>
            카톡으로
            <br />
            조부모님께 바로
          </li>
        </ul>
      </header>

      {/* 첫 화면의 유일한 증거 — 사진 한 장이 그림이 되는 장면.
          예전엔 /samples 안에만 있어서, 처음 온 사람은 81px 썸네일만 보고 사진을 요구받았다. */}
      {phase === "form" && (
        <section className="before-after hero-proof">
          <h2>사진 한 장이면 이렇게 돼요</h2>
          <p className="hint">
            아래 두 그림은 <b>왼쪽 사진 한 장</b>으로 만든 거예요.
            <br />
            장면이 바뀌어도 <b>같은 아이</b>가 주인공으로 이어집니다.
          </p>
          <div className="ba-row">
            <figure className="ba-photo">
              <Image
                src="/samples/guide-photo.jpg"
                alt="동화책 제작에 사용한 아이 사진 예시"
                width={600}
                height={900}
                sizes="(max-width: 560px) 33vw, 200px"
                priority
              />
              <figcaption>올린 사진</figcaption>
            </figure>
            <div className="ba-arrow" aria-hidden="true">
              →
            </div>
            <figure>
              <Image
                src="/samples/guide-cover.jpg"
                alt="사진을 바탕으로 그린 동화책 표지"
                width={SAMPLE_W}
                height={SAMPLE_H}
                sizes="(max-width: 560px) 46vw, 220px"
                priority
              />
              <figcaption>표지</figcaption>
            </figure>
            <figure>
              <Image
                src="/samples/guide-scene.jpg"
                alt="사진을 바탕으로 그린 동화책 본문 장면"
                width={SAMPLE_W}
                height={SAMPLE_H}
                sizes="(max-width: 560px) 62vw, 220px"
              />
              <figcaption>다른 장면, 같은 주인공</figcaption>
            </figure>
          </div>
        </section>
      )}

      {/* 사진을 올리기 직전에 가장 많이 망설인다 — 방문 170명 중 사진까지 온 사람이 8명이었다
          (2026-09-01 집계). 망설이는 이유를 여기서 미리 하나씩 지운다. */}
      {phase === "form" && (
        <section className="trust">
          <h2>안심하고 만들어보세요</h2>
          <ul>
            <li>
              <b>회원가입이 없어요</b> — 이메일도, 비밀번호도 묻지 않습니다
            </li>
            <li>
              <b>표지와 첫 장면은 무료</b> — 결제는 결과를 보고 정하세요
            </li>
            <li>
              <b>사진 원본은 서버에 저장하지 않아요</b> — 그림을 그리는 순간에만 씁니다
            </li>
            <li>
              <b>만든 동화는 이 기기 안에</b> — 언제든 직접 지울 수 있어요
            </li>
          </ul>
        </section>
      )}

      {phase === "form" && (
        <p className="more-samples">
          <a href="/samples">
            주제 {THEMES.length}가지 샘플 보기 →
          </a>
        </p>
      )}

      {phase === "form" && saved && (
        <section className="card resume-card">
          <div className="resume-head">
            <span className="resume-label">지난 동화 📖</span>
            <button className="resume-drop" onClick={dropSaved}>
              ✕ 지우기
            </button>
          </div>
          <div className="resume-title">《 {saved.draft.title} 》</div>
          <button className="btn secondary" onClick={() => openDraft(saved.draft, saved.paid)}>
            이어서 보기
          </button>
          <div className="hint">
            이 기기에만 저장돼 있어요. 아래에서 새 동화를 만들면 지난 동화는 지워집니다.
          </div>
        </section>
      )}

      {phase === "form" && (
        <section className="card">
          {kids.map((kid, idx) => (
            <div className="child-card" key={idx}>
              <div className="child-head">
                <span className="child-title">
                  {kids.length === 1 ? "🌟 우리 아이" : `🌟 ${["첫째", "둘째", "셋째"][idx]} 아이`}
                </span>
                {kids.length > 1 && (
                  <button
                    type="button"
                    className="child-remove"
                    onClick={() => setKids((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    ✕ 빼기
                  </button>
                )}
              </div>

              <div className="field">
                <label htmlFor={`name-${idx}`}>아이 이름</label>
                <input
                  id={`name-${idx}`}
                  type="text"
                  placeholder="예) 서아"
                  value={kid.name}
                  maxLength={12}
                  onChange={(e) => patchKid(idx, { name: e.target.value })}
                />
              </div>

              <div className="field">
                <label>성별</label>
                <div className="genders" role="radiogroup" aria-label="성별">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={kid.gender === "girl"}
                    className={`gender girl ${kid.gender === "girl" ? "active" : ""}`}
                    onClick={() => patchKid(idx, { gender: "girl" })}
                  >
                    <span className="emoji">👧</span>
                    여자아이
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={kid.gender === "boy"}
                    className={`gender boy ${kid.gender === "boy" ? "active" : ""}`}
                    onClick={() => patchKid(idx, { gender: "boy" })}
                  >
                    <span className="emoji">👦</span>
                    남자아이
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor={`age-${idx}`}>아이 나이</label>
                <select
                  id={`age-${idx}`}
                  value={kid.age}
                  onChange={(e) => patchKid(idx, { age: Number(e.target.value) })}
                >
                  {Array.from({ length: 11 }, (_, i) => i).map((a) => (
                    <option key={a} value={a}>
                      {a === 0 ? "0세 (돌 전 아기)" : `${a}세`}
                    </option>
                  ))}
                </select>
                <p className="hint">나이에 맞는 모습과 이야기 톤으로 만들어드려요.</p>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label>아이 사진</label>
                <input
                  ref={(el) => {
                    fileRefs.current[idx] = el;
                  }}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => handleFile(idx, e.target.files?.[0])}
                />
                {kid.photo ? (
                  <div
                    style={{ textAlign: "center" }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFile(idx, e.dataTransfer.files?.[0]);
                    }}
                  >
                    <div className="preview-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={kid.photo} alt="업로드한 아이 사진" />
                    </div>
                    <div className="change" onClick={() => openPicker(idx)}>
                      다른 사진으로 바꾸기
                    </div>
                  </div>
                ) : (
                  <div
                    className={`upload ${dragOver === idx ? "drag" : ""}`}
                    onClick={() => openPicker(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(idx);
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(null);
                      handleFile(idx, e.dataTransfer.files?.[0]);
                    }}
                  >
                    <div className="up-emoji">📷</div>
                    <div className="up-title">
                      {dragOver === idx ? "여기에 놓아주세요!" : "사진 올리기"}
                    </div>
                    <div className="up-sub">
                      {dragOver === idx
                        ? "사진을 놓으면 바로 올라가요"
                        : "클릭하거나 사진을 끌어다 놓아주세요"}
                    </div>
                  </div>
                )}
                {!kid.photo && (
                  <>
                    <PhotoGuide />
                    <ul className="photo-guide">
                      <li className="good">
                        <span>✅</span> 정면을 보고 <b>얼굴이 크고 또렷한</b> 사진
                      </li>
                    </ul>
                    {/* ❌ 세 줄은 접어둔다 — 사진을 올리기도 전에 조건부터 읽으면 까다로워 보인다 */}
                    <details className="fold">
                      <summary>이런 사진은 피해주세요</summary>
                      <ul className="photo-guide">
                        <li>
                          <span>❌</span> 옆모습·뒷모습, 눈을 감은 사진
                        </li>
                        <li>
                          <span>❌</span> 여러 명이 함께 있거나 얼굴이 작게 나온 사진
                        </li>
                        <li>
                          <span>❌</span> 모자·마스크·손으로 얼굴이 가려진 사진
                        </li>
                      </ul>
                    </details>
                  </>
                )}
                <div className="hint">
                  🔒 사진 원본은 <b>서버에 저장하지 않아요.</b> 그림을 그리는 그 순간에만 쓰고
                  바로 버립니다.
                </div>
              </div>
            </div>
          ))}

          {kids.length < MAX_CHILDREN && (
            <button
              type="button"
              className="add-child"
              onClick={() => setKids((prev) => [...prev, emptyChild()])}
            >
              👧👦 형제·자매 함께 나오기 — 아이 추가 ({kids.length}/{MAX_CHILDREN})
            </button>
          )}

          {/* 주제 12개 + 그림체 4개가 펼쳐져 있어서 무료 샘플 버튼이 3,469px 아래에 있었다.
              기본값을 정해두고 접는다 — 바꾸고 싶은 사람만 펼치면 된다 (2026-08-26). */}
          <details className="choices">
            <summary>
              <b>이야기와 그림체 고르기</b>
              <em>
                지금은 {THEMES.find((t) => t.id === theme)?.label ?? "우주 여행"} ·{" "}
                {ART_STYLES.find((a) => a.id === art)?.label ?? "사실적 그림"}
              </em>
            </summary>

            <div className="field">
            <label>어떤 이야기로 떠날까요?</label>
            <div className="themes" role="radiogroup" aria-label="이야기 주제">
              {THEMES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  role="radio"
                  aria-checked={theme === t.id}
                  className={`theme ${theme === t.id ? "active" : ""}`}
                  onClick={() => setTheme(t.id)}
                >
                  <span className="emoji">{t.emoji}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>어떤 그림으로 그릴까요?</label>
            <div className="arts" role="radiogroup" aria-label="그림체">
              {ART_STYLES.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  role="radio"
                  aria-checked={art === a.id}
                  className={`art ${art === a.id ? "active" : ""}`}
                  onClick={() => setArt(a.id)}
                >
                  {a.id === DEFAULT_ART && <i className="art-badge">가장 닮게</i>}
                  <span className="emoji">{a.emoji}</span>
                  <b>{a.label}</b>
                  <em>{a.sub}</em>
                </button>
              ))}
            </div>
            <div className="hint">
              사진을 가장 닮게 그리는 건 <b>사실적 그림</b>이에요. 그림책 느낌을 원하시면 수채화나
              크레파스를 골라주세요.
            </div>
            </div>
          </details>

          <ConsentBox checked={consents} onChange={setConsents} />

          {error && <div className="error">{error}</div>}

          <button className="btn" disabled={!canSubmit} onClick={start}>
            무료 샘플 만들기 🪄
          </button>
          <div className="hint" style={{ textAlign: "center", marginTop: 12, fontSize: 16 }}>
            표지 + {FREE_SCENES}장면을 <b>무료로 먼저</b> 보여드려요.
            <br />
            결제 전에 우리 아이가 어떻게 그려지는지 확인할 수 있어요.
          </div>
          <div className="voice-pitch">
            🔊 <b>엄마·아빠 목소리로 동화를 들려주세요.</b>
            <br />
            아이 사진 + 아이 이름 + 부모 목소리 — 세상에 하나뿐인 동화가 됩니다.
            <br />
            <span className="hint">
              지금은 오픈 기념으로 무료예요 (정식 오픈 시 제공 조건이 바뀔 수 있어요).
            </span>
          </div>
          <div className="hint" style={{ textAlign: "center", marginTop: 8, fontSize: 13 }}>
            무료 샘플을 만들면 <a href="/terms">이용약관</a>에 동의한 것으로 봅니다. 결제 관련
            동의는 결제하실 때 따로 받습니다.
          </div>
          <div className="price-card">
            <div className="price-anchor">
              <s>정가 {LIST_PRICE.toLocaleString()}원</s>
              <b>출시 기념 {PRICE.toLocaleString()}원</b>
            </div>
            <div className="price-what">이 가격에 모두 포함돼요</div>
            <ul className="price-includes">
              <li>표지 포함 11페이지 그림동화</li>
              <li>우리 아이 맞춤 이야기</li>
              <li>엄마·아빠 목소리로 읽어주기</li>
              <li>AI 목소리 읽어주기</li>
              <li>PDF 저장 · 소리책</li>
              <li>가족 공유 링크</li>
              <li>1년간 보관 (기기를 바꿔도 다시 열람)</li>
            </ul>
          </div>
        </section>
      )}

      {phase === "form" && (
        <section className="faq">
          <h2>자주 묻는 질문</h2>
          {[
            {
              q: "정말 무료인가요?",
              a: `표지와 첫 장면까지 무료로 확인할 수 있어요. 전체 ${TOTAL_PAGES}페이지 동화를 만들고 싶을 때만 결제하시면 됩니다.`,
            },
            {
              q: "아이 사진은 서버에 저장되나요?",
              a: "원본 사진은 서버에 저장하지 않아요. AI가 그림을 그리는 과정에서만 사용하고, 만들어진 동화는 이 기기(브라우저) 안에 저장됩니다.",
            },
            {
              q: "아이와 똑같이 나오나요?",
              a: "AI가 사진을 참고해 아이를 닮은 주인공으로 그립니다. 사진과 100% 같은 모습을 보장하지는 않아요. 그래서 결제 전에 표지와 첫 장면을 무료로 먼저 보여드립니다.",
            },
            {
              q: "형제·자매도 같이 넣을 수 있나요?",
              a: "네, 최대 3명까지 함께 주인공으로 나올 수 있어요.",
            },
            {
              q: "회원가입을 해야 하나요?",
              a: "아니요. 가입 없이 바로 만들 수 있어요.",
            },
            {
              q: "결제하면 무엇을 받게 되나요?",
              a: `표지 포함 ${TOTAL_PAGES}페이지 전체와 읽어주기(부모 목소리·AI 목소리), PDF 저장, 소리책, 가족 공유 링크가 열립니다.`,
            },
            {
              q: "동화는 얼마나 보관되나요?",
              a: "결제하거나 공유 링크를 만든 동화는 1년간 보관돼요. 폰을 바꿔도 링크로 다시 열 수 있고, 원하면 언제든 직접 지울 수 있습니다.",
            },
            {
              q: "부모 목소리 녹음은 어디에 저장되나요?",
              a: "녹음은 이 기기(브라우저) 안에 저장돼요. 공유 링크를 만들 때만 소리책에 함께 담깁니다.",
            },
          ].map((f) => (
            <details key={f.q} className="fold">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>
      )}

      {phase === "form" && <ReviewsSection />}

      {phase === "form" && <SavedShareList />}

      {phase === "generating" && (
        <section className="card">
          <div className="progress-wrap">
            <div className="spinner" />
            <h2>
              {joinCallNames(kids.map((k) => k.name.trim()).filter(Boolean))}의 동화책 샘플을
              만드는 중…
            </h2>
            <div className="step">{progressStep}</div>
            <div className="bar">
              <i style={{ width: `${progressPct}%` }} />
            </div>
            <div className="step">{progressPct}%</div>
            <p
              style={{
                color: "var(--ink-soft)",
                fontFamily: "var(--sans)",
                fontSize: 14,
                marginTop: 18,
              }}
            >
              삽화 한 장 한 장 정성껏 그리고 있어요.
              <br />
              1~2분 정도 걸릴 수 있어요 🎨
            </p>
          </div>
        </section>
      )}

      {phase === "book" && pages.length > 0 && (
        <BookViewer
          title={title}
          pages={pages}
          current={current}
          setCurrent={setCurrent}
          paid={paid}
          unlocking={unlocking}
          onPay={pay}
          onReset={reset}
          error={error}
          bookMeta={{
            kidsInfo: kids
              .filter((k) => k.name.trim())
              .map((k) => `${k.name.trim()}(${k.age}세)`)
              .join(", "),
            themeLabel: THEMES.find((t) => t.id === theme)?.label ?? "",
            artLabel: ART_STYLES.find((a) => a.id === art)?.label ?? "",
          }}
        />
      )}

      {cropping && (
        <PhotoCropper
          src={cropping.src}
          onCancel={() => setCropping(null)}
          onDone={(dataUrl) => {
            patchKid(cropping.idx, { photo: dataUrl });
            setCropping(null);
            trackStep("photo");
          }}
        />
      )}

      {testPass && (
        <div className={`test-badge ${testPass === "off" ? "bad" : ""}`}>
          {testPass === "on"
            ? "테스트 모드 · 한도 없음 · 집계 제외"
            : "이 브라우저엔 통행증이 없어요 — 테스트 링크를 여기서 열어주세요"}
        </div>
      )}

      {confirmDialog}
      {showBank && (
        <BankOrderBox
          bookTitle={title}
          price={PRICE}
          onPaid={unlockAfterBankPay}
          onClose={() => setShowBank(false)}
        />
      )}

      <footer className="footer">
        삽화는 AI가 사진을 참고해 새로 그린 그림이에요.
        <br />
        만든 이야기는 아이와 함께 읽어주세요 💛
        <div className="legal-links">
          <a href="/terms">이용약관</a>
          <a href="/refund">환불정책</a>
          <a href="/privacy">
            <b>개인정보처리방침</b>
          </a>
        </div>
        <div className="biz-info">
          <p className="biz-lead">
            ‘{BUSINESS.service}’은 {BUSINESS.name}이 운영하는 서비스입니다.
          </p>
          <p>
            상호 {BUSINESS.name} · 대표 {BUSINESS.owner} · 사업자등록번호 {BUSINESS.regNo} ·
            통신판매업신고 {BUSINESS.mailOrderNo}
          </p>
          <p>
            {BUSINESS.address} · {BUSINESS.tel} · {BUSINESS.email}
          </p>
          <p className="biz-copy">© 2026 {BUSINESS.name}</p>
        </div>
      </footer>
    </main>
  );
}

// 결제 전 동의 — 전자상거래법 제17조 제2항 제5호는 "이용자의 동의를 받아
// 콘텐츠 제공이 개시된 경우"에만 환불 제한을 인정하므로, 결제 버튼은 이 동의 없이 눌리지 않는다.
// 이용약관·환불정책 동의도 여기서 함께 받는다 — 무료 샘플 단계에서 결제 규정을 먼저
// 동의시키던 것을 돈이 오가는 이 지점으로 옮겼다 (2026-08-26).
function PayConsent({
  checked,
  onChange,
  compact = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "pay-consent compact" : "pay-consent"}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>이용약관·환불정책</b>에 동의하며, 결제하면 남은 장면 생성이 바로 시작되어{" "}
        <b>생성이 시작된 뒤에는 환불이 제한</b>되는 것에 동의합니다. (
        <a href="/terms" target="_blank" rel="noreferrer">
          이용약관
        </a>
        {" · "}
        <a href="/refund" target="_blank" rel="noreferrer">
          환불정책
        </a>
        )
      </span>
    </label>
  );
}

// 이 브라우저에서 만든 공유 링크 목록 — 새 동화를 만든 뒤에도 지난 링크를 지울 수 있게 한다.
function SavedShareList() {
  const [shares, setShares] = useState<SavedShare[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirmDialog, ask } = useConfirm();

  useEffect(() => {
    loadShares().then(setShares);
  }, []);

  if (shares.length === 0) return null;

  const remove = async (s: SavedShare) => {
    const ok = await ask({
      title: "공유 링크를 지울까요?",
      message: `《 ${s.title} 》 링크를 받은 사람도 더 이상 볼 수 없어요.`,
      confirmLabel: "지우기",
    });
    if (!ok) return;
    setBusy(s.id);
    setError(null);
    try {
      await deleteShareLink(s.id, s.deleteKey);
      await dropShare(s.id);
      setShares((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "링크를 지우지 못했어요.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      {confirmDialog}
      <div className="field">
        <label>내가 만든 공유 링크 🔗</label>
        <div className="hint">
          링크를 아는 사람만 볼 수 있고, 만든 날부터 1년 뒤 자동으로 지워져요.
        </div>
      </div>
      {shares.map((s) => (
        <div className="share-row" key={s.id}>
          <div className="share-row-title">《 {s.title} 》</div>
          <a className="share-url" href={s.url} target="_blank" rel="noreferrer">
            {s.url}
          </a>
          <button
            className="btn secondary"
            onClick={() => remove(s)}
            disabled={busy === s.id}
          >
            {busy === s.id ? "지우는 중…" : "링크 지우기"}
          </button>
        </div>
      ))}
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function BookViewer({
  title,
  pages,
  current,
  setCurrent,
  paid,
  unlocking,
  onPay,
  onReset,
  error,
  bookMeta,
}: {
  title: string;
  pages: BookPage[];
  current: number;
  setCurrent: (n: number) => void;
  paid: boolean;
  unlocking: boolean;
  onPay: () => void;
  onReset: () => void;
  error: string | null;
  bookMeta: { kidsInfo: string; themeLabel: string; artLabel: string };
}) {
  const total = pages.length;
  const page = pages[current];
  const isCover = page.kind === "cover";
  const isLocked = !paid && current > FREE_SCENES; // 표지(0)+장면 1..FREE_SCENES 무료
  const allDone = pages.every((p) => p.image !== null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false); // 결제 전 청약철회 제한 동의
  const [reviewed, setReviewed] = useState(true); // 로드 전에는 후기 폼을 숨긴다
  const [exporting, setExporting] = useState(false); // 소리책 만드는 중
  const [exportStep, setExportStep] = useState("");

  // ----- 공유 링크(웹 스토리북) — 누르지 않으면 아무것도 저장되지 않는 옵트인 -----
  const [sharing, setSharing] = useState(false);
  const [shareStep, setShareStep] = useState("");
  const [share, setShare] = useState<SavedShare | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  // ----- 읽어주기 -----
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("ai"); // 샘플 목소리 / 내 목소리
  const [narrator, setNarrator] = useState<NarratorId>("mom");
  const [reading, setReading] = useState(false); // 이어읽기 모드 재생 중
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [readNote, setReadNote] = useState<string | null>(null); // 오류가 아닌 안내 (녹음 없는 페이지 등)
  const audioRef = useRef<HTMLAudioElement | null>(null); // 하나를 재사용 (iOS 자동재생 잠금 대응)
  const audioCacheRef = useRef<Map<string, string>>(new Map()); // `${voice}-${page}` → objectURL
  const sessionRef = useRef(0); // 중지/전환 시 진행 중이던 재생 루프 무효화 토큰

  // 인쇄본 신청 폼 (mailto는 메일 앱 없는 기기에서 에러가 나서 폼으로 받는다)
  const [printFormOpen, setPrintFormOpen] = useState(false);
  const { confirmDialog, ask } = useConfirm();
  // 결제 표식에서 주문번호를 꺼내 신청 메일에 담는다 (bank-XXXX 형식이면 계좌이체 주문번호)
  const [payMarker, setPayMarker] = useState("");
  useEffect(() => {
    kvGet<string>("paidOrder").then((v) => setPayMarker(v ?? ""));
  }, []);

  // 내 목소리 녹음
  const [recordings, setRecordings] = useState<Map<number, Blob>>(new Map());
  const [recording, setRecording] = useState(false);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<BlobPart[]>([]);

  const stopReading = useCallback(() => {
    sessionRef.current++;
    audioRef.current?.pause();
    setReading(false);
    setAudioLoading(false);
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecRef.current?.stop(); // onstop에서 저장 + 마이크 해제
    mediaRecRef.current = null;
    setRecording(false);
  }, []);

  // 저장된 녹음 불러오기 (결제 리다이렉트/새로고침을 넘어 유지)
  useEffect(() => {
    (async () => {
      const saved = await kvGet<Record<number, Blob>>("recordings");
      if (saved) {
        setRecordings(new Map(Object.entries(saved).map(([k, v]) => [Number(k), v])));
      }
    })();
  }, []);

  // 언마운트(새 동화 만들기) 시 정리
  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      sessionRef.current++;
      audioRef.current?.pause();
      mediaRecRef.current?.stop();
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  const persistRecordings = useCallback((map: Map<number, Blob>) => {
    const obj: Record<number, Blob> = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    kvSet("recordings", obj).catch(() => {});
  }, []);

  const startRecording = useCallback(async () => {
    stopReading();
    setAudioError(null);
    setReadNote(null);
    // 인앱 브라우저(카톡 등)·구형 브라우저는 getUserMedia 자체가 없음
    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioError(
        "이 브라우저에서는 녹음을 지원하지 않아요. 크롬이나 사파리로 열어주세요. (카카오톡 안에서 열었다면 오른쪽 아래 메뉴에서 '다른 브라우저로 열기'를 눌러주세요)",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const idx = current; // 녹음 시작 시점의 페이지에 저장
      recChunksRef.current = [];
      mr.ondataavailable = (e) => recChunksRef.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType || "audio/webm" });
        setRecordings((prev) => {
          const next = new Map(prev).set(idx, blob);
          persistRecordings(next);
          return next;
        });
        // 재녹음 시 이전 objectURL 캐시 무효화
        const key = `mine-${idx}`;
        const old = audioCacheRef.current.get(key);
        if (old) {
          URL.revokeObjectURL(old);
          audioCacheRef.current.delete(key);
        }
      };
      mr.start();
      mediaRecRef.current = mr;
      setRecording(true);
    } catch (err) {
      // 원인별 안내 — 뭉뚱그린 메시지는 사용자가 어디를 고쳐야 할지 알 수 없음
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setAudioError(
          "마이크 권한이 차단되어 있어요. 주소창 왼쪽 자물쇠(🔒)를 눌러 '마이크'를 허용으로 바꾼 뒤 새로고침해주세요.",
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setAudioError(
          "연결된 마이크를 찾지 못했어요. 마이크(이어폰)를 연결했는지, Windows 설정 → 개인 정보 → 마이크에서 앱의 마이크 접근이 켜져 있는지 확인해주세요.",
        );
      } else if (name === "NotReadableError") {
        setAudioError(
          "다른 프로그램이 마이크를 사용 중이에요. 통화·녹음 앱을 닫고 다시 시도해주세요.",
        );
      } else {
        setAudioError("마이크를 사용할 수 없어요. 브라우저의 마이크 권한을 허용해주세요.");
      }
    }
  }, [current, stopReading, persistRecordings]);

  // 페이지 오디오 URL 얻기 — 내 목소리는 녹음 Blob, 샘플은 TTS API.
  // 녹음이 없는 페이지는 null 반환.
  const getAudioUrl = useCallback(
    async (idx: number): Promise<string | null> => {
      const key = voiceMode === "mine" ? `mine-${idx}` : `${narrator}-${idx}`;
      const cached = audioCacheRef.current.get(key);
      if (cached) return cached;

      let blob: Blob;
      if (voiceMode === "mine") {
        const rec = recordings.get(idx);
        if (!rec) return null;
        blob = rec;
      } else {
        const pg = pages[idx];
        const text = pg.kind === "cover" ? title : pg.text;
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, narrator }),
        });
        if (!res.ok) {
          const json = await safeJson(res);
          throw new Error((json.error as string) || "목소리 생성 실패");
        }
        blob = await res.blob();
      }
      const url = URL.createObjectURL(blob);
      audioCacheRef.current.set(key, url);
      return url;
    },
    [voiceMode, narrator, recordings, pages, title],
  );

  // idx 페이지부터 잠기지 않은 페이지까지 이어서 읽어준다
  const readFrom = useCallback(
    async (idx: number) => {
      sessionRef.current++;
      const session = sessionRef.current;
      setReading(true);
      setAudioError(null);
      setReadNote(null);

      // 사용자 제스처 안에서 오디오 엘리먼트를 만들어 iOS 자동재생 제한을 푼다
      if (!audioRef.current) {
        const el = new Audio();
        el.play().catch(() => {});
        audioRef.current = el;
      }
      const el = audioRef.current;

      try {
        let i = idx;
        while (i < total && !(!paid && i > FREE_SCENES)) {
          setCurrent(i);
          setAudioLoading(true);
          const url = await getAudioUrl(i);
          if (sessionRef.current !== session) return;
          setAudioLoading(false);

          if (!url) {
            // 내 목소리 모드에서 녹음이 없는 페이지 — 여기서 멈춘다
            setReadNote(
              i === idx
                ? "이 페이지는 아직 녹음이 없어요. 🎙 버튼으로 먼저 녹음해주세요."
                : "다음 페이지는 아직 녹음이 없어서 여기까지 읽었어요.",
            );
            break;
          }

          el.src = url;
          await new Promise<void>((resolve, reject) => {
            el.onended = () => resolve();
            el.onpause = () => {
              if (sessionRef.current !== session) resolve(); // 중지됨 — 루프 탈출
            };
            el.onerror = () => reject(new Error("오디오 재생에 실패했어요."));
            el.play().catch(reject);
          });
          if (sessionRef.current !== session) return;
          i++;
        }
        if (sessionRef.current === session) setReading(false);
      } catch (err) {
        if (sessionRef.current === session) {
          setAudioError(
            err instanceof Error ? err.message : "읽어주기에 실패했어요. 다시 시도해주세요.",
          );
          setReading(false);
          setAudioLoading(false);
        }
      }
    },
    [paid, total, setCurrent, getAudioUrl],
  );

  // 현재 페이지 녹음 미리듣기 (이어읽기 없이 한 장만)
  const playCurrentOnce = useCallback(async () => {
    sessionRef.current++;
    const session = sessionRef.current;
    setAudioError(null);
    setReadNote(null);
    if (!audioRef.current) {
      const el = new Audio();
      el.play().catch(() => {});
      audioRef.current = el;
    }
    const el = audioRef.current;
    const url = await getAudioUrl(current);
    if (!url || sessionRef.current !== session) return;
    el.src = url;
    el.onended = () => {
      if (sessionRef.current === session) setReading(false);
    };
    el.onpause = () => {
      if (sessionRef.current === session) setReading(false);
    };
    el.onerror = () => {
      if (sessionRef.current === session) {
        setReading(false);
        setAudioError("오디오 재생에 실패했어요.");
      }
    };
    setReading(true);
    el.play().catch(() => setReading(false));
  }, [current, getAudioUrl]);

  // 페이지별 음성을 Blob으로 모은다 (소리책·공유 링크 공용)
  // TTS는 재생 캐시(objectURL)가 있으면 재사용하고, 없으면 그때 생성한다.
  const collectAudios = useCallback(
    async (onStep: (i: number) => void): Promise<(Blob | null)[]> => {
      const out: (Blob | null)[] = [];
      for (let i = 0; i < pages.length; i++) {
        onStep(i);
        if (voiceMode === "mine") {
          out.push(recordings.get(i) ?? null);
        } else {
          const url = await getAudioUrl(i);
          out.push(url ? await fetch(url).then((r) => r.blob()) : null);
        }
      }
      return out;
    },
    [pages.length, voiceMode, recordings, getAudioUrl],
  );

  // ----- 소리책(그림+글+음성 단일 HTML) 내보내기 -----
  const exportSoundBook = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setAudioError(null);
    setReadNote(null);
    try {
      const blobs = await collectAudios((i) =>
        setExportStep(`목소리 담는 중… ${i + 1} / ${pages.length}`),
      );
      const audios = await Promise.all(blobs.map((b) => (b ? blobToDataUrl(b) : null)));
      setExportStep("소리책 파일 만드는 중…");
      downloadSoundBook(
        title,
        pages.map((p, i) => ({
          kind: p.kind,
          text: p.kind === "cover" ? title : p.text,
          image: p.image,
          audio: audios[i],
        })),
      );
    } catch (err) {
      setAudioError(
        err instanceof Error ? err.message : "소리책 저장에 실패했어요. 다시 시도해주세요.",
      );
    } finally {
      setExporting(false);
      setExportStep("");
    }
  }, [exporting, pages, title, collectAudios]);

  // 이 책의 후기를 이미 남겼는지
  useEffect(() => {
    kvGet<string[]>("reviewed").then((list) => setReviewed((list ?? []).includes(title)));
  }, [title]);

  // 이 책으로 이미 만들어 둔 공유 링크가 있으면 되살린다 (결제 리다이렉트 복귀 등)
  useEffect(() => {
    loadShares().then((list) => {
      const mine = list.filter((s) => s.title === title).pop();
      if (mine) setShare(mine);
    });
  }, [title]);

  // ----- 보관·공유 링크 만들기 (여기서 삽화·음성이 서버에 저장된다) -----
  // auto=true는 결제 완료 시 자동 보관(2026-08-14 결정) — 이때 직접 녹음한 목소리는
  // 올리지 않는다(녹음 업로드는 사용자가 버튼을 직접 누른 경우에만, 개인정보 약속).
  const makeShareLink = useCallback(async (auto = false): Promise<boolean> => {
    if (sharing) return false;
    setSharing(true);
    setAudioError(null);
    setReadNote(null);
    setShareCopied(false);
    try {
      const audios =
        auto && voiceMode === "mine"
          ? pages.map(() => null)
          : await collectAudios((i) =>
              setShareStep(`목소리 담는 중… ${i + 1} / ${pages.length}`),
            );
      const id = newShareId();
      const result = await createShareLink({
        id,
        title,
        pages: pages.map((p, i) => ({
          kind: p.kind,
          text: p.kind === "cover" ? title : p.text,
          image: p.image,
          audio: audios[i],
        })),
        onProgress: (done, total) => setShareStep(`올리는 중… ${done} / ${total}`),
      });
      const saved: SavedShare = {
        id,
        url: result.url,
        deleteKey: result.deleteKey,
        title,
        createdAt: Date.now(),
      };
      await addShare(saved);
      setShare(saved);
      trackEvery("share:create"); // 공유는 곧 유입 경로 — 몇 권이 밖으로 나가는지 센다

      // 결제한 주문이면 보관 링크를 이메일로도 보내준다 (주문당 한 번, 서버가 판단).
      // 브라우저가 지워져도 메일함의 링크로 책을 다시 열 수 있다.
      const order = paidMarkToOrder(await kvGet<PaidMark>("paidOrder"));
      if (order) {
        fetch("/api/share/notify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ order, bookId: id }),
        }).catch(() => {});
      }
      return true;
    } catch (err) {
      // 자동 보관 실패는 조용히 넘긴다 — 다음 방문 때 다시 시도되고, 수동 버튼도 살아 있다
      if (!auto) {
        setAudioError(
          err instanceof Error ? err.message : "공유 링크를 만들지 못했어요. 다시 시도해주세요.",
        );
      }
      return false;
    } finally {
      setSharing(false);
      setShareStep("");
    }
  }, [sharing, collectAudios, pages, title, voiceMode]);

  // 결제한 책은 완성되는 즉시 자동으로 링크를 만들어 서버에 1년 보관한다(2026-08-14 결정).
  // 책이 브라우저에만 있으면 사파리의 저장소 정리(7일 규칙)로 증발할 수 있어서다.
  // 시도 여부를 기기에 기록해, 사용자가 링크를 직접 지운 책을 되살리지 않는다.
  const backupRef = useRef(false);
  useEffect(() => {
    if (!paid || !allDone || share || sharing || backupRef.current) return;
    backupRef.current = true;
    (async () => {
      const done = (await kvGet<string[]>("autoBackedUp")) ?? [];
      if (done.includes(title)) return;
      // 성공했을 때만 기록 — 실패한 채 기록하면 다시는 시도하지 않게 된다
      if (await makeShareLink(true)) {
        await kvSet("autoBackedUp", [...done, title].slice(-50));
      }
    })();
  }, [paid, allDone, share, sharing, title, makeShareLink]);

  const copyShareLink = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      setAudioError("복사에 실패했어요. 주소를 길게 눌러 직접 복사해주세요.");
    }
  };

  const removeShareLink = async () => {
    if (!share || sharing) return;
    const ok = await ask({
      title: "보관·공유 링크를 지울까요?",
      message:
        "링크를 받은 사람도 더 이상 볼 수 없고,\n서버에 보관된 책도 함께 지워져 다시 만들 수 없어요.",
      confirmLabel: "지우기",
    });
    if (!ok) return;
    setSharing(true);
    try {
      await deleteShareLink(share.id, share.deleteKey);
      await dropShare(share.id);
      // 직접 지운 책은 자동 보관이 몰래 되살리면 안 된다 — 시도 기록에 올려 재생성을 막는다
      const done = (await kvGet<string[]>("autoBackedUp")) ?? [];
      if (!done.includes(share.title)) {
        await kvSet("autoBackedUp", [...done, share.title].slice(-50));
      }
      setShare(null);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : "링크를 지우지 못했어요.");
    } finally {
      setSharing(false);
    }
  };

  const switchMode = (m: VoiceMode) => {
    if (reading || audioLoading) stopReading();
    if (recording) stopRecording();
    setReadNote(null);
    setVoiceMode(m);
  };

  const pickNarrator = (id: NarratorId) => {
    if (reading || audioLoading) stopReading(); // 목소리를 바꾸면 재생 중지
    setNarrator(id);
  };

  const go = (n: number) => {
    if (reading || audioLoading) stopReading(); // 직접 페이지를 넘기면 이어읽기 중지
    if (recording) stopRecording(); // 페이지를 넘기면 녹음도 종료(시작한 페이지에 저장)
    setCurrent(Math.max(0, Math.min(total - 1, n)));
  };

  const savePdf = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await downloadStoryPdf(title, pages);
    } catch {
      setSaveError("PDF 저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="book">
      {confirmDialog}
      <h2 className="book-title">《 {title} 》</h2>

      <div className="page">
        <div className="illus">
          {isLocked ? (
            <div className="locked">
              <div className="lock-emoji">🔒</div>
              <div className="lock-title">여기부터는 잠겨 있어요</div>
              <div className="lock-sub">
                결제하면 남은 {total - 1 - FREE_SCENES}페이지(총 {total}페이지)와
                <br />
                읽어주기, PDF 다운로드가 열립니다
              </div>
              <div className="price-anchor">
                <s>정가 {LIST_PRICE.toLocaleString()}원</s>
                <b>출시 기념 {PRICE.toLocaleString()}원</b>
              </div>
              <PayConsent checked={agreed} onChange={setAgreed} compact />
              <button className="btn lock-btn" onClick={onPay} disabled={!agreed}>
                {PRICE.toLocaleString()}원으로 전체 열기 🔓
              </button>
              {PAY_MODE === "bank" && (
                <div className="hint" style={{ marginTop: 8 }}>
                  지금은 계좌이체로 받고 있어요
                </div>
              )}
            </div>
          ) : page.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.image} alt={isCover ? "표지" : `${current}번째 장면`} />
          ) : (
            <div className="mini-spin" />
          )}
        </div>
        {isCover ? (
          <div className="cover-caption">✦ 표지 ✦</div>
        ) : isLocked ? (
          <div className="caption locked-caption">
            🔒 이야기가 계속됩니다…
            <div className="pagenum">— {current} —</div>
          </div>
        ) : (
          <div className="caption">
            {page.text}
            <div className="pagenum">— {current} —</div>
          </div>
        )}
      </div>

      <div className="read-aloud">
        <div className="read-title">🔊 누가 읽어줄까요?</div>

        <div className="voice-tabs" role="radiogroup" aria-label="읽어주기 방식">
          <button
            type="button"
            role="radio"
            aria-checked={voiceMode === "ai"}
            className={`voice-tab ${voiceMode === "ai" ? "active" : ""}`}
            onClick={() => switchMode("ai")}
          >
            ✨ 샘플 목소리
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={voiceMode === "mine"}
            className={`voice-tab ${voiceMode === "mine" ? "active" : ""}`}
            onClick={() => switchMode("mine")}
          >
            🎙 내 목소리 <span className="voice-free-badge">오픈 기념 무료</span>
          </button>
        </div>

        {voiceMode === "ai" ? (
          <div className="narrators" role="radiogroup" aria-label="읽어주는 목소리">
            {NARRATOR_LIST.map((n) => (
              <button
                type="button"
                key={n.id}
                role="radio"
                aria-checked={narrator === n.id}
                className={`narrator ${narrator === n.id ? "active" : ""}`}
                onClick={() => pickNarrator(n.id)}
              >
                <span className="emoji">{n.emoji}</span>
                {n.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="rec-panel">
            <div className={`rec-status ${recording ? "live" : ""}`}>
              {recording
                ? "🔴 녹음 중이에요 — 또박또박 읽어주세요"
                : recordings.has(current)
                  ? "이 페이지 녹음 완료 ✅"
                  : isCover
                    ? "표지예요 — 책 제목을 읽어서 녹음해보세요"
                    : "이 페이지는 아직 녹음이 없어요"}
            </div>
            <div className="rec-actions">
              <button
                className={`rec-btn ${recording ? "stop" : ""}`}
                onClick={recording ? stopRecording : startRecording}
                disabled={isLocked}
              >
                {recording
                  ? "■ 녹음 끝내기"
                  : recordings.has(current)
                    ? "🎙 다시 녹음하기"
                    : "🎙 이 페이지 녹음하기"}
              </button>
              {!recording && recordings.has(current) && (
                <button className="rec-btn ghost" onClick={playCurrentOnce}>
                  ▶ 들어보기
                </button>
              )}
            </div>
            <div className="hint" style={{ marginTop: 8, textAlign: "center" }}>
              {recordings.size} / {total} 페이지 녹음됨 · 녹음은 이 기기에만 저장돼요
            </div>
          </div>
        )}

        <button
          className="read-btn"
          onClick={reading || audioLoading ? stopReading : () => readFrom(current)}
          disabled={isLocked || recording || (voiceMode === "mine" && !recordings.has(current))}
        >
          {audioLoading
            ? "목소리를 준비하고 있어요…"
            : reading
              ? "⏹ 그만 읽기"
              : "▶ 여기부터 읽어주기"}
        </button>
        {readNote && <div className="read-note">{readNote}</div>}
        {audioError && <div className="error">{audioError}</div>}
      </div>

      <div className="nav">
        <button onClick={() => go(current - 1)} disabled={current === 0}>
          ← 이전
        </button>
        <div className="dots">
          {pages.map((_, i) => (
            <i
              key={i}
              className={`${i === current ? "on" : ""} ${!paid && i > FREE_SCENES ? "lock" : ""}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <button onClick={() => go(current + 1)} disabled={current === total - 1}>
          다음 →
        </button>
      </div>

      {unlocking && (
        <div className="unlock-note">
          🎨 결제 확인! 남은 장면들을 그리고 있어요… (
          {pages.filter((p) => p.image).length - 1} / {total - 1})
        </div>
      )}

      {!paid && (
        <div className="price-anchor" style={{ marginTop: 18 }}>
          <s>정가 {LIST_PRICE.toLocaleString()}원</s>
          <b>출시 기념 {PRICE.toLocaleString()}원</b>
        </div>
      )}
      {!paid && <PayConsent checked={agreed} onChange={setAgreed} />}
      <div className="actions">
        {!paid ? (
          <button className="btn" onClick={onPay} disabled={!agreed}>
            {PAY_MODE === "bank"
              ? `${PRICE.toLocaleString()}원 계좌이체로 전체 보기 🔓`
              : `${PRICE.toLocaleString()}원 결제하고 전체 보기 🔓`}
          </button>
        ) : (
          <>
            <button className="btn" onClick={savePdf} disabled={saving || !allDone}>
              {saving
                ? "PDF 만드는 중… 📄"
                : !allDone
                  ? "삽화 완성 중… 잠시만요"
                  : "PDF로 저장 📄"}
            </button>
            <button
              className="btn soundbook"
              onClick={exportSoundBook}
              disabled={exporting || !allDone}
            >
              {exporting ? exportStep || "소리책 만드는 중… 🔊" : "소리책으로 저장 🔊"}
            </button>
            {!share && (
              <button
                className="btn share"
                onClick={() => makeShareLink()}
                disabled={sharing || !allDone}
              >
                {sharing ? shareStep || "공유 링크 만드는 중… 🔗" : "링크로 공유하기 🔗"}
              </button>
            )}
          </>
        )}
        <button className="btn secondary" onClick={onReset}>
          새 동화 만들기
        </button>
      </div>
      {paid && (
        <div className="hint" style={{ textAlign: "center", marginTop: 8, lineHeight: 1.8 }}>
          소리책은 파일 하나에 그림과{" "}
          {voiceMode === "mine"
            ? "직접 녹음한 목소리"
            : `${NARRATOR_LIST.find((n) => n.id === narrator)?.label} 목소리`}
          가 담겨요. 인터넷 없이 열립니다.
          <br />
          카톡으로 가족에게 보낼 거라면 <b>링크로 공유하기</b>가 편해요 — 폰에서 바로 열리고 소리도
          나옵니다.
        </div>
      )}

      {paid && share && (
        <div className="share-box">
          <div className="share-title">책 보관·공유 링크가 준비됐어요 🔗</div>
          <div className="share-url">{share.url}</div>
          <div className="share-actions">
            <button className="btn" onClick={copyShareLink}>
              {shareCopied ? "복사됐어요 ✓" : "주소 복사하기"}
            </button>
            <button className="btn secondary" onClick={removeShareLink} disabled={sharing}>
              링크 지우기
            </button>
          </div>
          <div className="hint" style={{ marginTop: 10, lineHeight: 1.8 }}>
            이 링크가 책 보관본이에요 — 폰을 바꾸거나 브라우저 기록이 지워져도 열 수 있으니
            잘 간직해주세요.
            <br />
            링크를 아는 사람만 볼 수 있고(검색에는 안 잡혀요), 만든 날부터 1년 뒤 자동으로
            지워지며 언제든 직접 지울 수도 있어요.
          </div>
        </div>
      )}

      {paid && (
        <div className="upsell">
          <div className="upsell-emoji">📖</div>
          <div className="upsell-badge">1차 제작 30권 한정</div>
          <div className="upsell-title">실물 동화책으로도 소장하세요</div>
          <div className="upsell-sub">
            양장 제본 인쇄본 <b>29,900원</b>
            <br />
            한 권씩 찍으면 값이 크게 올라서, 신청을 모아 <b>30권씩 한 번에</b>{" "}
            제작해요.
            <br />
            1차 제작분은 신청하신 순서대로 배정해 드릴게요.
          </div>
          <button type="button" className="upsell-btn" onClick={() => setPrintFormOpen(true)}>
            1차 제작분 신청하기 ✉️
          </button>
          {printFormOpen && (
            <PrintRequestForm
              bookTitle={title}
              bookMeta={bookMeta}
              orderNo={payMarker.replace(/^bank-/, "")}
              shareUrl={share?.url ?? ""}
              onClose={() => setPrintFormOpen(false)}
            />
          )}
          <div className="upsell-note">
            지금은 신청만 받아요. 결제는 제작이 확정된 뒤에 따로 안내드릴게요.
          </div>
        </div>
      )}

      {paid && allDone && !reviewed && (
        <ReviewForm
          bookTitle={title}
          onDone={async () => {
            const list = (await kvGet<string[]>("reviewed")) ?? [];
            await kvSet("reviewed", [...list, title]);
          }}
        />
      )}

      {(saveError || error) && <div className="error">{saveError || error}</div>}
    </section>
  );
}
