"use client";

// 사진 업로드·생성 전에 받는 법정 동의 UI.
// 전체 동의 한 번으로 끝낼 수 있게 하되, 항목별로 펼쳐 확인할 수 있어야 한다.
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
      <label className="consent-all">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={() => onChange(allChecked ? [] : [...REQUIRED_CONSENT_IDS])}
        />
        <span>
          <b>전체 동의</b>
          <em>아래 5개 항목에 모두 동의합니다</em>
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
                  onClick={() => setOpenId(open ? null : item.id)}
                >
                  {open ? "접기 ▲" : "자세히 ▼"}
                </button>
              </div>
              <div className="consent-summary">{item.summary}</div>
              {open && (
                <div className="consent-body">
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
        아이의 사진 원본은 <b>어떤 경우에도 서버에 저장하지 않습니다.</b> 완성된 동화는{" "}
        <b>&lsquo;링크로 공유하기&rsquo;를 직접 누른 경우에만</b> 서버에 보관되고(1년 후 자동
        삭제), 그 외에는 이 기기에만 남아요. 자세한 내용은{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">
          개인정보처리방침
        </a>
        에서 확인하실 수 있어요.
      </div>
    </div>
  );
}
