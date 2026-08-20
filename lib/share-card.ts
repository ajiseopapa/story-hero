"use client";

// 인스타 자랑 카드 — 표지 + 제목 + 주소를 4:5(1080×1350) PNG 한 장으로 그린다.
// 인스타 게시물엔 링크를 못 붙이므로, 카드에 새긴 주소가 곧 유입 경로다.

const W = 1080;
const H = 1350;

export async function drawShareCard(coverUrl: string, title: string): Promise<Blob> {
  const img = new Image();
  img.src = coverUrl;
  await img.decode();

  // 본편과 같은 고운바탕이 실려야 "책" 느낌이 난다 — 못 실으면 시스템 바탕체로 그린다
  try {
    await document.fonts.load('700 60px "Gowun Batang"');
  } catch {
    // 폰트 로딩 실패는 카드 생성을 막을 이유가 아니다
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");

  // 앱 배경과 같은 종이 그라데이션
  const bg = ctx.createRadialGradient(W * 0.25, H * 0.15, 80, W / 2, H / 2, H);
  bg.addColorStop(0, "#fbf6ec");
  bg.addColorStop(0.55, "#f7efe2");
  bg.addColorStop(1, "#efe3cf");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 표지 — 원본 비율 유지, 세로 960에 맞춰 중앙 배치
  const ih = 960;
  const iw = Math.min(W - 160, ih * (img.naturalWidth / img.naturalHeight));
  const ix = (W - iw) / 2;
  const iy = 96;
  const radius = 28;

  const roundedPath = () => {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(ix, iy, iw, ih, radius);
    } else {
      ctx.rect(ix, iy, iw, ih);
    }
  };

  ctx.save();
  ctx.shadowColor = "rgba(74, 63, 53, 0.3)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  roundedPath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedPath();
  ctx.clip();
  ctx.drawImage(img, ix, iy, iw, ih);
  ctx.restore();

  // 제목 — 길면 카드 폭에 들어올 때까지 글자를 줄인다
  const text = `《 ${title} 》`;
  ctx.fillStyle = "#3d3329";
  ctx.textAlign = "center";
  let size = 62;
  do {
    ctx.font = `700 ${size}px "Gowun Batang", "Nanum Myeongjo", serif`;
    size -= 2;
  } while (size > 34 && ctx.measureText(text).width > W - 140);
  ctx.fillText(text, W / 2, iy + ih + 96);

  ctx.font = '400 33px "Gowun Batang", "Nanum Myeongjo", serif';
  ctx.fillStyle = "#675746";
  ctx.fillText("우리 아이가 주인공인 그림동화", W / 2, iy + ih + 152);

  // 주소 워터마크 — 카드가 어디로 흘러가든 이것만 남으면 된다
  ctx.font =
    '600 34px "Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif';
  ctx.fillStyle = "#e08a7b";
  ctx.fillText("story.kidstel.co.kr", W / 2, H - 56);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}
