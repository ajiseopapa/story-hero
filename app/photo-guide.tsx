/**
 * 어떤 사진을 올려야 하는지 그림으로 보여준다.
 *
 * 글로만 적어두면 "정면을 보고 얼굴이 크고 또렷한 사진"이 어느 정도인지 감이 안 온다.
 * 방문한 사람의 95%가 사진을 올리기 전에 나가는 상황이라(2026-09-01 집계), 이 한 걸음을
 * 최대한 쉽게 만들어야 한다.
 *
 * 실제 아이 사진 대신 도형으로 그린다 — 남의 아이 얼굴을 예시로 쓸 이유가 없고,
 * 도형이 오히려 "얼굴이 이만큼 커야 한다"는 크기 비교를 분명하게 보여준다.
 */

function Frame({ children, ok, label }: { children: React.ReactNode; ok?: boolean; label: string }) {
  return (
    <figure className={`pg-cell ${ok ? "ok" : "no"}`}>
      <svg viewBox="0 0 100 100" role="img" aria-label={label}>
        <rect x="0" y="0" width="100" height="100" rx="10" className="pg-bg" />
        {children}
      </svg>
      <figcaption>
        <span aria-hidden="true">{ok ? "✅" : "❌"}</span> {label}
      </figcaption>
    </figure>
  );
}

/** 정면 얼굴 — cx·cy·r로 크기와 위치만 바꿔 쓴다 */
function Face({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g className="pg-face">
      <circle cx={cx} cy={cy} r={r} className="pg-skin" />
      <circle cx={cx - r * 0.35} cy={cy - r * 0.1} r={r * 0.09} className="pg-ink" />
      <circle cx={cx + r * 0.35} cy={cy - r * 0.1} r={r * 0.09} className="pg-ink" />
      <path
        d={`M ${cx - r * 0.3} ${cy + r * 0.35} Q ${cx} ${cy + r * 0.62} ${cx + r * 0.3} ${cy + r * 0.35}`}
        className="pg-line"
      />
    </g>
  );
}

export default function PhotoGuide() {
  return (
    <div className="photo-guide-visual">
      <Frame ok label="정면·크게">
        <Face cx={50} cy={52} r={30} />
      </Frame>

      <Frame label="너무 작아요">
        {/* 몸을 함께 그려야 "얼굴이 작다"가 크기 비교로 읽힌다 */}
        <path d="M 32 100 Q 50 58 68 100 Z" className="pg-skin" />
        <Face cx={50} cy={40} r={11} />
      </Frame>

      <Frame label="옆모습">
        <g className="pg-face">
          <circle cx="46" cy="52" r="27" className="pg-skin" />
          {/* 코 — 옆얼굴로 읽히게 하는 건 결국 이 삼각형 하나다 */}
          <path d="M 70 46 L 82 55 L 69 62 Z" className="pg-skin" />
          <circle cx="58" cy="46" r="3.2" className="pg-ink" />
          <path d="M 66 64 Q 60 68 54 66" className="pg-line" />
        </g>
      </Frame>

      <Frame label="가려졌어요">
        <Face cx={50} cy={52} r={30} />
        <rect x="18" y="52" width="64" height="26" rx="8" className="pg-cover" />
      </Frame>
    </div>
  );
}
