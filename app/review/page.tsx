"use client";

// 후기 전용 주소. 후기 요청 메일의 링크가 여기로 온다.
//
// ⭐ 왜 따로 있나: 손님이 만든 책은 그 브라우저(IndexedDB)에만 있어서, 메인 화면의 후기 칸은
//    책을 만든 그 기기에서만 뜬다. 손님은 PDF·소리책 파일을 내려받아 갖고 있을 뿐이고
//    메일은 다른 기기에서 읽는 게 보통이다. 그래서 주문번호+토큰만으로 어느 기기에서든
//    열리는 후기 페이지가 필요하다.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReviewForm from "../review-form";

type State =
  | { phase: "loading" }
  | { phase: "ready"; bookTitle: string }
  | { phase: "error"; message: string };

function ReviewPageInner() {
  const params = useSearchParams();
  const o = params.get("o") ?? "";
  const t = params.get("t") ?? "";
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    if (!o || !t) {
      setState({
        phase: "error",
        message: "주소가 올바르지 않아요. 메일에 있는 링크를 그대로 눌러주세요.",
      });
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/review/context?o=${encodeURIComponent(o)}&t=${encodeURIComponent(t)}`,
        );
        const data = (await res.json()) as { bookTitle?: string; error?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(data.error || "주문을 확인하지 못했어요.");
        setState({ phase: "ready", bookTitle: data.bookTitle ?? "" });
      } catch (err) {
        if (!alive) return;
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : "주문을 확인하지 못했어요.",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [o, t]);

  return (
    <main className="wrap">
      <section className="card" style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 24, margin: "0 0 6px" }}>
          동화책은 어떠셨나요?
        </h1>
        {state.phase === "ready" && state.bookTitle && (
          <p style={{ color: "var(--ink-soft)", margin: 0 }}>《 {state.bookTitle} 》</p>
        )}
      </section>

      {state.phase === "loading" && (
        <section className="card">
          <div className="hint" style={{ textAlign: "center" }}>
            주문을 확인하고 있어요…
          </div>
        </section>
      )}

      {state.phase === "error" && (
        <section className="card">
          <div className="error">{state.message}</div>
          <div className="hint" style={{ marginTop: 10 }}>
            링크가 안 열리면 이 메일에 그대로 답장해 주셔도 됩니다. 제가 직접 받아 적어둘게요.
          </div>
        </section>
      )}

      {state.phase === "ready" && (
        <ReviewForm bookTitle={state.bookTitle} order={{ o, t }} onDone={() => {}} />
      )}
    </main>
  );
}

export default function ReviewPage() {
  return (
    <Suspense>
      <ReviewPageInner />
    </Suspense>
  );
}
