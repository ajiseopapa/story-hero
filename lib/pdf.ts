// 동화책 → PDF 저장.
// jsPDF에는 한글 내장 폰트가 없으므로, 글은 canvas에 그린 뒤(브라우저 폰트 사용)
// 이미지로 넣는 방식으로 한글을 처리한다.
//
// ⭐ 삽화와 글은 따로 넣는다(2026-09-05). 전에는 페이지 전체를 캔버스 한 장에 그려 JPEG로
// 넣었더니 글자에 JPEG 압축 번짐이 들어가 흐릿했다. 지금은 삽화만 JPEG, 글 영역은 2배
// 해상도로 그려 무손실 PNG로 넣는다 — 글 배경이 단색이라 PNG여도 몇십 KB다.
import { jsPDF } from "jspdf";

export type PdfPage = {
  kind: "cover" | "scene";
  text: string; // 표지는 제목, 장면은 본문
  image: string | null; // data URL
};

const W = 1024; // 삽화 원본 폭
const IMG_H = 1536; // 삽화 원본 높이 (1024x1536)
const CAP_H = 320; // 텍스트 영역 높이
const PAGE_H = IMG_H + CAP_H;
const TEXT_SCALE = 2; // 글 영역 해상도 배율 — 인쇄해도 획이 뭉개지지 않게
const PAPER = "#fbf6ec";
const INK = "#4a3f35";
// 고운바탕은 400/700 두 굵기뿐 — 800을 주면 브라우저가 가짜 굵게를 만들어 뭉개진다
const FONT = "'Gowun Batang', 'Nanum Myeongjo', serif";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 로드 실패"));
    img.src = src;
  });
}

// 한글 줄바꿈: 캔버스 실측 폭 기준으로 자름
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line !== "") {
      // 어절 중간에서 끊기지 않게 마지막 공백에서 되돌아가기
      const lastSpace = line.lastIndexOf(" ");
      if (lastSpace > maxWidth / 60) {
        lines.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1) + ch;
      } else {
        lines.push(line);
        line = ch;
      }
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// 삽화 → 원본 크기 JPEG (data URL이 PNG면 여기서 줄어든다)
async function renderImage(src: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF 페이지를 그릴 수 없어요.");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, IMG_H);
  ctx.drawImage(await loadImage(src), 0, 0, W, IMG_H);
  return canvas.toDataURL("image/jpeg", 0.9);
}

// 글 영역 → 2배 해상도 PNG. 좌표는 원래 크기(W × CAP_H) 기준으로 쓴다.
function renderCaption(page: PdfPage, pageNum: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = W * TEXT_SCALE;
  canvas.height = CAP_H * TEXT_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF 페이지를 그릴 수 없어요.");
  ctx.scale(TEXT_SCALE, TEXT_SCALE);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, CAP_H);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (page.kind === "cover") {
    // 표지 제목도 줄바꿈 — 형제 이름이 여럿 붙으면 한 줄에 안 들어가 잘린다
    let lineHeight = 78;
    ctx.font = `700 56px ${FONT}`;
    let lines = wrapText(ctx, `《 ${page.text} 》`, W - 140);
    // 넘치면 폰트 축소
    if (lines.length * lineHeight > CAP_H - 40) {
      lineHeight = 62;
      ctx.font = `700 44px ${FONT}`;
      lines = wrapText(ctx, `《 ${page.text} 》`, W - 120);
    }
    const startY = (CAP_H - (lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) =>
      ctx.fillText(line, W / 2, startY + i * lineHeight),
    );
  } else {
    let lineHeight = 52;
    ctx.font = `34px ${FONT}`;
    let lines = wrapText(ctx, page.text, W - 140);
    // 넘치면 폰트 축소
    if (lines.length * lineHeight > CAP_H - 40) {
      lineHeight = 42;
      ctx.font = `28px ${FONT}`;
      lines = wrapText(ctx, page.text, W - 120);
    }
    const startY = (CAP_H - (lines.length - 1) * lineHeight) / 2 - 14;
    lines.forEach((line, i) =>
      ctx.fillText(line, W / 2, startY + i * lineHeight),
    );

    // 페이지 번호 (장면 페이지만)
    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = "#7a6a58";
    ctx.fillText(`— ${pageNum} —`, W / 2, CAP_H - 32);
  }

  return canvas.toDataURL("image/png");
}

export async function downloadStoryPdf(
  title: string,
  pages: PdfPage[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  // 폰트가 로드된 뒤 캔버스에 그려야 명조체가 적용됨
  if (document.fonts?.ready) await document.fonts.ready;

  const doc = new jsPDF({
    unit: "px",
    format: [W, PAGE_H],
    orientation: "portrait",
    hotfixes: ["px_scaling"],
    compress: true,
  });

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) doc.addPage([W, PAGE_H], "portrait");
    const page = pages[i];
    if (page.image) {
      doc.addImage(await renderImage(page.image), "JPEG", 0, 0, W, IMG_H);
    } else {
      doc.setFillColor(PAPER);
      doc.rect(0, 0, W, IMG_H, "F");
    }
    // 표지=0, 장면은 1부터. 2배로 그린 PNG를 원래 크기로 넣으면 PDF 안에서 고해상도로 남는다
    doc.addImage(renderCaption(page, i), "PNG", 0, IMG_H, W, CAP_H);
    onProgress?.(i + 1, pages.length);
  }

  const safe = title.replace(/[\\/:*?"<>|]/g, "").trim() || "동화책";
  doc.save(`${safe}.pdf`);
}
