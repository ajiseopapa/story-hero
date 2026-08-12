// 동화책 → PDF 저장.
// jsPDF에는 한글 내장 폰트가 없으므로, 각 페이지를 canvas에 그린 뒤(브라우저 폰트 사용)
// 이미지로 넣는 방식으로 한글을 처리한다.
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
const PAPER = "#fbf6ec";
const INK = "#4a3f35";

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

async function renderPage(page: PdfPage, pageNum: number): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF 페이지를 그릴 수 없어요.");

  // 배경
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, PAGE_H);

  // 삽화
  if (page.image) {
    const img = await loadImage(page.image);
    ctx.drawImage(img, 0, 0, W, IMG_H);
  }

  // 텍스트 영역
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (page.kind === "cover") {
    ctx.font = "800 56px 'Gowun Batang', 'Nanum Myeongjo', serif";
    ctx.fillText(`《 ${page.text} 》`, W / 2, IMG_H + CAP_H / 2);
  } else {
    let fontSize = 34;
    let lineHeight = 52;
    ctx.font = `${fontSize}px 'Gowun Batang', 'Nanum Myeongjo', serif`;
    let lines = wrapText(ctx, page.text, W - 140);
    // 넘치면 폰트 축소
    if (lines.length * lineHeight > CAP_H - 40) {
      fontSize = 28;
      lineHeight = 42;
      ctx.font = `${fontSize}px 'Gowun Batang', 'Nanum Myeongjo', serif`;
      lines = wrapText(ctx, page.text, W - 120);
    }
    const startY = IMG_H + (CAP_H - (lines.length - 1) * lineHeight) / 2 - 14;
    lines.forEach((line, i) => {
      ctx.fillText(line, W / 2, startY + i * lineHeight);
    });

    // 페이지 번호 (장면 페이지만)
    ctx.font = "22px 'Gowun Batang', 'Nanum Myeongjo', serif";
    ctx.fillStyle = "#7a6a58";
    ctx.fillText(`— ${pageNum} —`, W / 2, PAGE_H - 32);
  }

  return canvas.toDataURL("image/jpeg", 0.88);
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
    const pageImg = await renderPage(pages[i], i); // 표지=0, 장면은 1부터

    doc.addImage(pageImg, "JPEG", 0, 0, W, PAGE_H);
    onProgress?.(i + 1, pages.length);
  }

  const safe = title.replace(/[\\/:*?"<>|]/g, "").trim() || "동화책";
  doc.save(`${safe}.pdf`);
}
