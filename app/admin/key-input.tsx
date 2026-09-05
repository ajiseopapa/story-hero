"use client";

/**
 * 관리자 코드 입력란. 4자리를 다 치거나 Enter를 누르면 넘긴다 —
 * 글자마다 넘기면 첫 글자에서 입력란이 사라져 버린다(!key 조건으로 보이니까).
 */
import { useState } from "react";

const CODE_LENGTH = 4;

export function AdminKeyInput({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      autoFocus
      placeholder="관리자 코드 4자리"
      value={draft}
      onChange={(e) => {
        const v = e.target.value.trim();
        setDraft(v);
        if (v.length >= CODE_LENGTH) onSubmit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft) onSubmit(draft);
      }}
    />
  );
}
