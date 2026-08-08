"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_CHILDREN, THEMES, joinCallNames, type ThemeId } from "@/lib/prompts";
import { downloadStoryPdf } from "@/lib/pdf";
import { blobToDataUrl, downloadSoundBook } from "@/lib/soundbook";
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
const PRICE = Number(process.env.NEXT_PUBLIC_PRICE ?? "12900");
const LIST_PRICE = 19900; // 앵커링용 정가 표시

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
): Promise<string> {
  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos, imagePrompt, kind, children }),
  });
  const json = await safeJson(res);
  if (!res.ok) throw new Error((json.error as string) || "삽화 생성 실패");
  return json.image as string;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("form");
  const [kids, setKids] = useState<ChildForm[]>([emptyChild()]);
  const [theme, setTheme] = useState<ThemeId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [progressStep, setProgressStep] = useState("");
  const [progressPct, setProgressPct] = useState(0);

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<BookPage[]>([]);
  const [current, setCurrent] = useState(0);
  const [paid, setPaid] = useState(false);
  const [unlocking, setUnlocking] = useState(false); // 결제 후 나머지 생성 중

  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  const restoredRef = useRef(false);
  const [dragOver, setDragOver] = useState<number | null>(null); // 드래그 중인 아이 카드 index

  const canSubmit =
    theme !== null &&
    kids.length > 0 &&
    kids.every((k) => k.name.trim().length > 0 && k.gender !== null && k.photo !== null);

  const patchKid = useCallback((idx: number, patch: Partial<ChildForm>) => {
    setKids((prev) => prev.map((k, i) => (i === idx ? { ...k, ...patch } : k)));
  }, []);

  // ----- 결제 리다이렉트 후 복원 -----
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      const draft = await kvGet<Draft>("draft");
      if (!draft) return;
      const paidOrder = await kvGet<string>("paidOrder");
      const q = new URLSearchParams(window.location.search);
      const cameBack = q.has("paid") || q.has("resume") || paidOrder;
      if (!cameBack) return;
      window.history.replaceState(null, "", "/");

      setTitle(draft.title);
      setKids(draftToKids(draft));
      setPages(draft.pages);
      setCurrent(Math.min(draft.current, draft.pages.length - 1));
      setPhase("book");

      if (paidOrder) {
        setPaid(true);
        await resumeGeneration(draft);
      }
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
        const img = await fetchImage(photos, p.imagePrompt, p.kind, specs);
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

  const handleFile = useCallback(
    async (idx: number, file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("이미지 파일을 올려주세요.");
        return;
      }
      try {
        setError(null);
        const dataUrl = await fileToScaledDataUrl(file);
        patchKid(idx, { photo: dataUrl });
      } catch {
        setError("사진을 불러오지 못했어요. 다른 사진을 시도해주세요.");
      }
    },
    [patchKid],
  );

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
        const img = await fetchImage(photos, cur[i].imagePrompt, cur[i].kind, children);
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
      } satisfies Draft);

      setCurrent(0);
      setPhase("book");
    } catch (err) {
      setError(err instanceof Error ? err.message : "문제가 발생했어요. 다시 시도해주세요.");
      setPhase("form");
    }
  }, [canSubmit, kids, theme]);

  // ----- 결제 -----
  const pay = useCallback(async () => {
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
  }, [title, pages, current, kids]);

  const reset = useCallback(() => {
    setPhase("form");
    setKids([emptyChild()]);
    setPages([]);
    setTitle("");
    setCurrent(0);
    setPaid(false);
    setProgressPct(0);
    setProgressStep("");
    setError(null);
    kvDel("draft");
    kvDel("paidOrder");
    kvDel("recordings");
  }, []);

  return (
    <main className="wrap">
      <header className="hero">
        <span className="badge">우리 아이가 주인공 ✨</span>
        <h1>동화책 속 주인공이 되어보아요</h1>
        <p>
          아이 이름과 사진을 넣으면,
          <br />
          포근한 수채화 그림동화의 주인공이 됩니다.
          <br />
          형제·자매가 <b>함께 주인공</b>이 될 수도 있어요 👧👦
        </p>
      </header>

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
                        : "클릭하거나 사진을 끌어다 놓아주세요 · 정면 사진일수록 예뻐요"}
                    </div>
                  </div>
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

          {error && <div className="error">{error}</div>}

          <button className="btn" disabled={!canSubmit} onClick={start}>
            무료 샘플 만들기 🪄
          </button>
          <div className="hint" style={{ textAlign: "center", marginTop: 12, fontSize: 16 }}>
            표지 + {FREE_SCENES}장면을 무료로 보여드려요. 마음에 들면 전체 동화책(10장면) +
            읽어주기 + PDF를 받아보세요.
          </div>
          <div className="price-anchor">
            <s>정가 {LIST_PRICE.toLocaleString()}원</s>
            <b>출시 기념 {PRICE.toLocaleString()}원</b>
          </div>
        </section>
      )}

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

      <footer className="footer">
        수채화 삽화는 AI가 사진을 참고해 새로 그린 그림이에요.
        <br />
        만든 이야기는 아이와 함께 읽어주세요 💛
      </footer>
    </main>
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
  const [exporting, setExporting] = useState(false); // 소리책 만드는 중
  const [exportStep, setExportStep] = useState("");

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
    } catch {
      setAudioError("마이크를 사용할 수 없어요. 브라우저의 마이크 권한을 허용해주세요.");
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

  // ----- 소리책(그림+글+음성 단일 HTML) 내보내기 -----
  const exportSoundBook = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setAudioError(null);
    setReadNote(null);
    try {
      const audios: (string | null)[] = [];
      for (let i = 0; i < pages.length; i++) {
        setExportStep(`목소리 담는 중… ${i + 1} / ${pages.length}`);
        if (voiceMode === "mine") {
          const rec = recordings.get(i);
          audios.push(rec ? await blobToDataUrl(rec) : null);
        } else {
          // TTS — 재생 캐시(objectURL)가 있으면 재사용, 없으면 생성
          const url = await getAudioUrl(i);
          if (!url) {
            audios.push(null);
          } else {
            const blob = await fetch(url).then((r) => r.blob());
            audios.push(await blobToDataUrl(blob));
          }
        }
      }
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
  }, [exporting, pages, title, voiceMode, recordings, getAudioUrl]);

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
              <button className="btn lock-btn" onClick={onPay}>
                {PRICE.toLocaleString()}원으로 전체 열기 🔓
              </button>
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
      <div className="actions">
        {!paid ? (
          <button className="btn" onClick={onPay}>
            {PRICE.toLocaleString()}원 결제하고 전체 보기 🔓
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
          </>
        )}
        <button className="btn secondary" onClick={onReset}>
          새 동화 만들기
        </button>
      </div>
      {paid && (
        <div className="hint" style={{ textAlign: "center", marginTop: 8 }}>
          소리책은 파일 하나에 그림과{" "}
          {voiceMode === "mine"
            ? "직접 녹음한 목소리"
            : `${NARRATOR_LIST.find((n) => n.id === narrator)?.label} 목소리`}
          가 담겨요. 인터넷 없이 열리고 가족에게 보낼 수 있어요.
        </div>
      )}

      {paid && (
        <div className="upsell">
          <div className="upsell-emoji">📖</div>
          <div className="upsell-title">실물 동화책으로도 소장하세요</div>
          <div className="upsell-sub">
            양장 제본 인쇄본 <b>29,900원</b> — 지금 준비 중이에요.
            <br />
            사전 신청하시면 준비되는 대로 가장 먼저 알려드릴게요.
          </div>
          <a
            className="upsell-btn"
            href={`mailto:sensitivetk@gmail.com?subject=${encodeURIComponent(
              `[동화책 인쇄본 사전신청] ${title}`,
            )}&body=${encodeURIComponent(
              "실물 인쇄본이 준비되면 연락 주세요!\n연락 받으실 이메일 또는 전화번호를 남겨주세요:\n",
            )}`}
          >
            인쇄본 사전 신청하기 ✉️
          </a>
        </div>
      )}

      {(saveError || error) && <div className="error">{saveError || error}</div>}
    </section>
  );
}
