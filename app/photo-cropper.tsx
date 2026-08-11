"use client";

// 사진 자르기 — 얼굴이 화면에서 차지하는 비율이 닮음을 좌우한다.
// 원본을 그대로 보내면 배경·다른 사람까지 참조 픽셀을 나눠 갖게 되므로,
// 삽화 판형(2:3)에 맞춰 얼굴 중심으로 잘라 1024x1536으로 내보낸다.
import { useCallback, useEffect, useRef, useState } from "react";

const OUT_W = 1024;
const OUT_H = 1536;
const MAX_ZOOM = 3;

type Props = {
  src: string; // 방금 고른 사진 (data URL)
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
};

export default function PhotoCropper({ src, onCancel, onDone }: Props) {
  const [url, setUrl] = useState(src);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const el = new Image();
    el.onload = () => {
      setImg(el);
      setZoom(1);
      setPos({ x: 0, y: 0 });
    };
    el.src = url;
  }, [url]);

  // 프레임 크기가 바뀌면(회전·주소창 접힘 등) 다시 재서 배율을 맞춘다
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setFrame({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 프레임을 항상 가득 채우는 배율을 1배로 삼는다 (빈 여백이 생기지 않게)
  const baseScale =
    img && frame.w ? Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight) : 1;
  const scale = baseScale * zoom;

  const clamp = useCallback(
    (p: { x: number; y: number }) => {
      if (!img || !frame.w) return p;
      const maxX = Math.max(0, (img.naturalWidth * scale - frame.w) / 2);
      const maxY = Math.max(0, (img.naturalHeight * scale - frame.h) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, p.x)),
        y: Math.min(maxY, Math.max(-maxY, p.y)),
      };
    },
    [img, frame.w, frame.h, scale],
  );

  useEffect(() => {
    setPos((p) => clamp(p));
  }, [clamp]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPos(clamp({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // 90도 회전은 이미지를 미리 돌려둔다 (자르기 계산은 회전 없는 상태로 유지)
  const rotate = (dir: -1 | 1) => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    setUrl(canvas.toDataURL("image/jpeg", 0.95));
  };

  const confirm = () => {
    if (!img || !frame.w) return;
    // 프레임에 보이는 영역을 원본 좌표로 환산
    const sx = (img.naturalWidth * scale) / 2 - pos.x - frame.w / 2;
    const sy = (img.naturalHeight * scale) / 2 - pos.y - frame.h / 2;
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(
      img,
      sx / scale,
      sy / scale,
      frame.w / scale,
      frame.h / scale,
      0,
      0,
      OUT_W,
      OUT_H,
    );
    onDone(canvas.toDataURL("image/jpeg", 0.92));
  };

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true">
      <div className="crop-sheet">
        <div className="crop-head">
          <b>사진 자르기</b>
          <span>
            얼굴이 <b>최대한 크게</b> 들어오도록 맞춰주세요. 닮음에 가장 큰 영향을 줍니다.
          </span>
        </div>

        <div
          className="crop-frame"
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt="자를 사진"
              draggable={false}
              style={{
                width: img.naturalWidth * scale,
                height: img.naturalHeight * scale,
                transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
              }}
            />
          )}
          <div className="crop-grid" />
        </div>

        <div className="crop-zoom">
          <span>축소</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <span>확대</span>
        </div>

        <div className="crop-tools">
          <button type="button" onClick={() => rotate(-1)}>
            ↺ 왼쪽
          </button>
          <button type="button" onClick={() => rotate(1)}>
            ↻ 오른쪽
          </button>
        </div>

        <div className="crop-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn" onClick={confirm} disabled={!img}>
            이 사진으로 할게요
          </button>
        </div>
      </div>
    </div>
  );
}
