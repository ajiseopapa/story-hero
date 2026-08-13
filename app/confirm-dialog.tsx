"use client";

/**
 * 사이트 디자인에 맞는 확인 창.
 * 브라우저 기본 confirm()은 "story.kidstel.co.kr 내용:" 머리말이 붙은 시스템 창이라
 * 서비스의 따뜻한 톤과 어울리지 않았다 (2026-08-13). window.confirm처럼
 * `await ask({...})`로 물어보고 boolean을 받는 훅으로 쓴다.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";

interface ConfirmOpts {
  title: string;
  /** \n은 줄바꿈으로 표시된다 */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function useConfirm(): {
  confirmDialog: ReactNode;
  ask: (opts: ConfirmOpts) => Promise<boolean>;
} {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setOpts(o);
      }),
    [],
  );

  const close = (v: boolean) => {
    resolveRef.current?.(v);
    resolveRef.current = null;
    setOpts(null);
  };

  const confirmDialog = opts ? (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3 style={{ marginTop: 0 }}>{opts.title}</h3>
        <p className="hint" style={{ whiteSpace: "pre-line", lineHeight: 1.8 }}>{opts.message}</p>
        <div className="share-actions">
          <button className="btn" onClick={() => close(true)}>
            {opts.confirmLabel ?? "네"}
          </button>
          <button className="btn secondary" onClick={() => close(false)}>
            {opts.cancelLabel ?? "취소"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirmDialog, ask };
}
