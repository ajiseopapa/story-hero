"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { SAMPLES, SAMPLE_H, SAMPLE_W } from "@/lib/samples";
import {
  ART_STYLES,
  DEFAULT_ART,
  MAX_CHILDREN,
  THEMES,
  joinCallNames,
  type ThemeId,
} from "@/lib/prompts";
import { BUSINESS } from "@/lib/business";
import { downloadStoryPdf } from "@/lib/pdf";
import { blobToDataUrl, downloadSoundBook } from "@/lib/soundbook";
import { createShareLink, deleteShareLink, newShareId } from "@/lib/sharebook-client";
import { CONSENT_VERSION, REQUIRED_CONSENT_IDS } from "@/lib/consent";
import { trackEvery, trackStep } from "@/lib/track";
import BankOrderBox, { checkBankOrderPaid, clearBankOrder, loadBankOrder } from "./bank-order";
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
): Promise<string> {
  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos, imagePrompt, kind, children, art }),
  });
  const json = await safeJson(res);
  if (!res.ok) throw new Error((json.error as string) || "삽화 생성 실패");
  return json.image as string;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("form");
  const [kids, setKids] = useState<ChildForm[]>([emptyChild()]);
  const [theme, setTheme] = useState<ThemeId | null>(null);
  const [art, setArt] = useState<string>(DEFAULT_ART); // 그림체
  const [error, setError] = useState<string | null>(null);

  const [progressStep, setProgressStep] = useState("");
  const [progressPct, setProgressPct] = useState(0);

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<BookPage[]>([]);
  const [current, setCurrent] = useState(0);
  const [paid, setPaid] = useState(false);
  const [unlocking, setUnlocking] = useState(false); // 결제 후 나머지 생성 중
  // 이 브라우저에 저장된 지난 동화 — 자동으로 펼치지 않고 첫 화면에 "이어보기" 카드로만 안내
  const [saved, setSaved] = useState<{ draft: Draft; paid: boolean } | null>(null);

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
  const openDraft = useCallback((draft: Draft, isPaid: boolean) => {
    setTitle(draft.title);
    setArt(draft.art ?? "watercolor"); // 예전 초안은 수채화로 그렸다
    setKids(draftToKids(draft));
    setPages(draft.pages);
    setCurrent(Math.min(draft.current, draft.pages.length - 1));
    setPaid(isPaid);
    setSaved(null);
    setPhase("book");
  }, []);

  // ----- 결제 리다이렉트 후 복원 -----
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      const draft = await kvGet<Draft>("draft");
      if (!draft) return;
      let paidOrder = await kvGet<string>("paidOrder");

      // 계좌이체로 주문해둔 게 있으면 그새 입금 확인이 됐는지 물어본다.
      // 카드 결제와 같은 표식(paidOrder)으로 바꿔 두면 아래 흐름이 그대로 재사용된다.
      // 표식을 옮긴 뒤 주문 기록은 지운다 — 남겨두면 다음에 만든 새 동화까지 열려버린다.
      if (!paidOrder) {
        const bank = await loadBankOrder();
        if (bank && (await checkBankOrderPaid(bank))) {
          paidOrder = `bank-${bank.orderNo}`;
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

  // 결제 후 아직 안 그려진 장면들을 이어서 생성
  const resumeGeneration = useCallback(async (draft: Draft) => {
    const missing = draft.pages
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.image);
    if (missing.length === 0) return;
    const drawKids = draftToKids(draft);
    const photos = drawKids.map((k) => k.photo).filter((p): p is string => !!p);
    const specs = drawKids.map((k) => ({ age: k.age, gender: k.gender ?? ("girl" as Gender) }));
    if (photos.length === 0) return;
    setUnlocking(true);
    try {
      let cur = draft.pages;
      for (const { p, i } of missing) {
        // 결제 전에 그리던 그림체를 그대로 이어간다 (예전 초안엔 값이 없어 수채화)
        const img = await fetchImage(photos, p.imagePrompt, p.kind, specs, draft.art ?? "");
        cur = cur.map((pg, j) => (j === i ? { ...pg, image: img } : pg));
        setPages(cur);
        await kvSet("draft", { ...draft, pages: cur });
      }
    } catch {
      setError("남은 삽화를 그리다 오류가 났어요. 새로고침하면 이어서 그립니다.");
    } finally {
      setUnlocking(false);
    }
  }, []);

  // 고른 사진은 바로 쓰지 않고 자르기 화면을 먼저 띄운다 (얼굴 비율이 닮음을 좌우)
  const handleFile = useCallback(async (idx: number, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일을 올려주세요.");
      return;
    }
    try {
      setError(null);
      const dataUrl = await fileToScaledDataUrl(file, 1600); // 자르기 화면용 원본
      setCropping({ idx, src: dataUrl });
    } catch {
      setError("사진을 불러오지 못했어요. 다른 사진을 시도해주세요.");
    }
  }, []);

  // ----- 샘플 생성 (표지 + FREE_SCENES 장면) -----
  const start = useCallback(async () => {
    if (!canSubmit) return;
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
    setProgressPct(4);
    setProgressStep("이야기를 짓고 있어요…");

    try {
      const storyRes = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ children, theme }),
      });
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
      for (let i = 0; i < freeCount; i++) {
        setProgressStep(
          i === 0 ? "표지 삽화를 그리고 있어요…" : `샘플 ${i} / ${FREE_SCENES} 장면을 그리고 있어요…`,
        );
        const img = await fetchImage(photos, cur[i].imagePrompt, cur[i].kind, children, art);
        cur = cur.map((pg, j) => (j === i ? { ...pg, image: img } : pg));
        setPages(cur);
        setProgressPct(Math.round(((i + 1) / freeCount) * 100));
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
      setPhase("book");
      trackStep("sample:done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "문제가 발생했어요. 다시 시도해주세요.");
      setPhase("form");
      trackEvery("sample:fail"); // 실패는 매번 센다 — 재시도 횟수까지 알아야 원인이 보인다
    }
  }, [canSubmit, kids, theme, art]);

  // ----- 결제 -----
  const pay = useCallback(async () => {
    // 구매 의사는 결제창이 뜨기 전에 센다 — 결제 설정이 없어도 "사려고 했다"는 사실은 남아야 한다
    trackStep("pay:click");

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
  }, [title, pages, current, kids, art]);

  // 계좌이체 입금이 확인됐을 때 — 카드 결제 성공과 같은 자리로 합류시킨다.
  const unlockAfterBankPay = useCallback(async () => {
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
    await kvSet("paidOrder", "bank");
    // 주문 기록은 여기서 지운다 — 남겨두면 다음에 만드는 새 동화까지 공짜로 열린다
    await clearBankOrder();
    await resumeGeneration(draft);
  }, [title, pages, current, kids, art, resumeGeneration]);

  const reset = useCallback(() => {
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
  }, []);

  // 첫 화면의 "지난 동화" 카드 지우기 — 저장된 초안·결제기록·녹음을 함께 정리한다.
  const dropSaved = useCallback(() => {
    if (!confirm("저장된 지난 동화를 지울까요? 이 기기에서는 다시 열 수 없어요.")) return;
    setSaved(null);
    kvDel("draft");
    kvDel("paidOrder");
    kvDel("recordings");
  }, []);

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">키즈북 ✨</span>
        <h1>
          진짜 우리 아이가
          <br />
          주인공인 동화책
        </h1>
        <p>
          사진 속 얼굴을 그대로 살려 그림동화로 그립니다.
          <br />
          <b>표지는 무료</b>예요 — 얼굴을 먼저 보고 결제하세요.
        </p>
        <ul className="hero-points">
          <li>
            <span className="hp-emoji">👀</span>
            결제 전<br />
            얼굴 확인
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

      {phase === "form" && (
        <section className="sample-strip">
          <div className="sample-strip-head">
            <b>이런 그림이 나와요</b>
          </div>
          <div className="sample-strip-row">
            {SAMPLES.slice(0, 4).map((s) => (
              <a key={s.id} href="/samples" aria-label={`${s.label} 샘플 보기`}>
                <Image
                  src={`/samples/${s.id}.jpg`}
                  alt={`${s.label} 주제의 동화 삽화 샘플`}
                  width={SAMPLE_W}
                  height={SAMPLE_H}
                  sizes="150px"
                />
                <span>{s.label}</span>
              </a>
            ))}
          </div>
        </section>
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
                <div className="genders">
                  <div
                    className={`gender girl ${kid.gender === "girl" ? "active" : ""}`}
                    onClick={() => patchKid(idx, { gender: "girl" })}
                    role="button"
                  >
                    <span className="emoji">👧</span>
                    여자아이
                  </div>
                  <div
                    className={`gender boy ${kid.gender === "boy" ? "active" : ""}`}
                    onClick={() => patchKid(idx, { gender: "boy" })}
                    role="button"
                  >
                    <span className="emoji">👦</span>
                    남자아이
                  </div>
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
                    <div className="change" onClick={() => fileRefs.current[idx]?.click()}>
                      다른 사진으로 바꾸기
                    </div>
                  </div>
                ) : (
                  <div
                    className={`upload ${dragOver === idx ? "drag" : ""}`}
                    onClick={() => fileRefs.current[idx]?.click()}
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
                  <ul className="photo-guide">
                    <li className="good">
                      <span>✅</span> 정면을 보고 <b>얼굴이 크고 또렷한</b> 사진
                    </li>
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
                )}
                <div className="hint">사진은 삽화를 그리는 데에만 쓰이고 저장하지 않아요.</div>
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

          <div className="field">
            <label>어떤 이야기로 떠날까요?</label>
            <div className="themes">
              {THEMES.map((t) => (
                <div
                  key={t.id}
                  className={`theme ${theme === t.id ? "active" : ""}`}
                  onClick={() => setTheme(t.id)}
                  role="button"
                >
                  <span className="emoji">{t.emoji}</span>
                  {t.label}
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label>어떤 그림으로 그릴까요?</label>
            <div className="arts">
              {ART_STYLES.map((a) => (
                <div
                  key={a.id}
                  className={`art ${art === a.id ? "active" : ""}`}
                  onClick={() => setArt(a.id)}
                  role="button"
                >
                  {a.id === DEFAULT_ART && <i className="art-badge">가장 닮게</i>}
                  <span className="emoji">{a.emoji}</span>
                  <b>{a.label}</b>
                  <em>{a.sub}</em>
                </div>
              ))}
            </div>
            <div className="hint">
              사진을 가장 닮게 그리는 건 <b>사실적 그림</b>이에요. 그림책 느낌을 원하시면 수채화나
              크레파스를 골라주세요.
            </div>
          </div>

          <ConsentBox checked={consents} onChange={setConsents} />

          {error && <div className="error">{error}</div>}

          <button className="btn" disabled={!canSubmit} onClick={start}>
            무료 샘플 만들기 🪄
          </button>
          <div className="hint" style={{ textAlign: "center", marginTop: 12, fontSize: 16 }}>
            표지 + {FREE_SCENES}장면을 <b>무료로 먼저</b> 보여드려요. 아이 얼굴이 마음에 들 때만
            결제하시면, 전체 10장면과 읽어주기·PDF·공유 링크가 열립니다.
          </div>
          <div className="price-anchor">
            <s>정가 {LIST_PRICE.toLocaleString()}원</s>
            <b>출시 기념 {PRICE.toLocaleString()}원</b>
          </div>
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

// 결제 전 청약철회 제한 동의 — 전자상거래법 제17조 제2항 제5호는 "이용자의 동의를 받아
// 콘텐츠 제공이 개시된 경우"에만 환불 제한을 인정하므로, 결제 버튼은 이 동의 없이 눌리지 않는다.
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
        결제하면 남은 장면 생성이 바로 시작되며, <b>생성이 시작된 뒤에는 환불이 제한</b>되는 것에
        동의합니다. (
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

  useEffect(() => {
    loadShares().then(setShares);
  }, []);

  if (shares.length === 0) return null;

  const remove = async (s: SavedShare) => {
    if (!confirm(`《 ${s.title} 》 공유 링크를 지울까요? 링크를 받은 사람도 더 이상 볼 수 없어요.`))
      return;
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

  // ----- 공유 링크 만들기 (여기서 처음으로 삽화·음성이 서버에 저장된다) -----
  const makeShareLink = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    setAudioError(null);
    setReadNote(null);
    setShareCopied(false);
    try {
      const audios = await collectAudios((i) =>
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
    } catch (err) {
      setAudioError(
        err instanceof Error ? err.message : "공유 링크를 만들지 못했어요. 다시 시도해주세요.",
      );
    } finally {
      setSharing(false);
      setShareStep("");
    }
  }, [sharing, collectAudios, pages, title]);

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
    if (!confirm("공유 링크를 지울까요? 링크를 받은 사람도 더 이상 볼 수 없어요.")) return;
    setSharing(true);
    try {
      await deleteShareLink(share.id, share.deleteKey);
      await dropShare(share.id);
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
      <h2 className="book-title">《 {title} 》</h2>

      <div className="page">
        <div className="illus">
          {isLocked ? (
            <div className="locked">
              <div className="lock-emoji">🔒</div>
              <div className="lock-title">여기부터는 잠겨 있어요</div>
              <div className="lock-sub">
                결제하면 남은 {total - 1 - FREE_SCENES}개 장면과
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

        <div className="voice-tabs">
          <div
            className={`voice-tab ${voiceMode === "ai" ? "active" : ""}`}
            onClick={() => switchMode("ai")}
            role="button"
          >
            ✨ 샘플 목소리
          </div>
          <div
            className={`voice-tab ${voiceMode === "mine" ? "active" : ""}`}
            onClick={() => switchMode("mine")}
            role="button"
          >
            🎙 내 목소리
          </div>
        </div>

        {voiceMode === "ai" ? (
          <div className="narrators">
            {NARRATOR_LIST.map((n) => (
              <div
                key={n.id}
                className={`narrator ${narrator === n.id ? "active" : ""}`}
                onClick={() => pickNarrator(n.id)}
                role="button"
              >
                <span className="emoji">{n.emoji}</span>
                {n.label}
              </div>
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
                onClick={makeShareLink}
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
          <div className="share-title">공유 링크가 준비됐어요 🔗</div>
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
            링크를 아는 사람만 볼 수 있어요(검색에는 잡히지 않아요).
            <br />
            만든 날부터 1년 뒤 자동으로 지워지고, 언제든 직접 지울 수도 있어요.
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
          <a
            className="upsell-btn"
            href={`mailto:sensitivetk@gmail.com?subject=${encodeURIComponent(
              `[동화책 인쇄본 1차 제작 신청] ${title}`,
            )}&body=${encodeURIComponent(
              "1차 제작분으로 신청할게요!\n연락 받으실 이메일 또는 전화번호를 남겨주세요:\n",
            )}`}
          >
            1차 제작분 신청하기 ✉️
          </a>
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
