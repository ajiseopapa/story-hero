"use client";

// 사진 업로드·생성 전에 받는 법정 동의 UI.
// 전체 동의 한 번으로 끝낼 수 있게 하되, 항목별로 펼쳐 확인할 수 있어야 한다.
//
// 순서가 중요하다 (2026-08-26). 예전에는 '민감정보', '미국으로 전송' 같은 문장이
// 무료 샘플 버튼 바로 위에 늘어서 있고, 안심시키는 문장(사진 원본은 저장하지 않는다)이
// 그 아래에 있었다. 부모가 가장 겁내는 문장을 클릭 직전에 읽는 배치였다.
// 지금은 안심 문장이 먼저 오고, 항목 설명은 '자세히'를 눌러야 펼쳐진다.
import { useState } from "react";
import { CONSENT_ITEMS, REQUIRED_CONSENT_IDS } from "@/lib/consent";

type Props = {
  checked: string[];
  onChange: (next: string[]) => void;
};

export default function ConsentBox({ checked, onChange }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const allChecked = REQUIRED_CONSENT_IDS.every((id) => checked.includes(id));

  const toggle = (id: string) => {
    onChange(checked.includes(id) ? checked.filter((c) => c !== id) : [...checked, id]);
  };

  return (
    <div className="consent">
      <div className="consent-lead">
        아이의 <b>사진 원본은 서버에 저장하지 않습니다.</b> 삽화를 그리는 그 순간에만 쓰고 바로
        버려요. 무료 샘플만 이용하시면 서버에 남는 것이 없습니다.
      </div>

      <label className="consent-all">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={() => onChange(allChecked ? [] : [...REQUIRED_CONSENT_IDS])}
        />
        <span>
          <b>보호자 동의 (전체 동의)</b>
          <em>아래 {REQUIRED_CONSENT_IDS.length}개 항목에 모두 동의합니다</em>
        </span>
      </label>

      <ul className="consent-list">
        {CONSENT_ITEMS.map((item) => {
          const open = openId === item.id;
          return (
            <li key={item.id}>
              <div className="consent-row">
                <label>
                  <input
                    type="checkbox"
                    checked={checked.includes(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span>
                    {item.title} <i className="consent-req">필수</i>
                  </span>
                </label>
                <button
                  type="button"
                  className="consent-more"
                  aria-expanded={open}
                  aria-controls={`consent-body-${item.id}`}
                  onClick={() => setOpenId(open ? null : item.id)}
                >
                  {open ? "접기 ▲" : "자세히 ▼"}
                </button>
              </div>
              {open && (
                <div className="consent-body" id={`consent-body-${item.id}`}>
                  <p className="consent-summary">{item.summary}</p>
                  {item.body.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="hint">
        결제하시면 완성된 동화(그림·글)를 <b>1년간 보관</b>해 폰을 바꿔도 다시 열 수 있어요.
        자세한 내용은{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">
          개인정보처리방침
        </a>
        에서 확인하실 수 있어요.
      </div>
    </div>
  );
}
