// 동화책 → PDF 저장.
// jsPDF에는 한글 내장 폰트가 없으므로, 글은 canvas에 그린 뒤(브라우저 폰트 사용)
// 이미지로 넣는 방식으로 한글을 처리한다.
//
// ⭐ 14,900원짜리 결과물이다(2026-09-05 TK님). 그래서
//  - 글 영역은 3배 해상도(인쇄 기준 약 370dpi)로 그려 무손실 PNG로 넣는다. 전에는 페이지
//    전체를 캔버스 한 장에 그려 JPEG로 넣었더니 글자에 압축 번짐이 들어가 흐릿했다.
//  - 삽화는 원본 크기 JPEG 0.95 — 눈으로 구분되지 않는 손실만 허용한다.
//  - 파일 정보(제목·제작자)를 넣고, 맨 뒤에 "누구를 위해 언제 만든 책인지" 판권 페이지를 붙인다.
import { jsPDF } from "jspdf";

export type PdfPage = {
  kind: "cover" | "scene";
  text: string; // 표지는 제목, 장면은 본문
  image: string | null; // data URL
};

export type PdfMeta = {
  /** "지우(6세), 하늘(4세)" — 판권 페이지의 "○○를 위해 만든 이야기"에 쓴다 */
  kidsInfo?: string;
};

const W = 1024; // 삽화 원본 폭
const IMG_H = 1536; // 삽화 원본 높이 (1024x1536)
const CAP_H = 320; // 텍스트 영역 높이
const PAGE_H = IMG_H + CAP_H;
const TEXT_SCALE = 3; // 글 영역 해상도 배율 — 인쇄해도 획이 뭉개지지 않게
// 종이 크기: 폭 140mm(높이는 같은 비율로 254mm). px 그대로 두면 27×49cm 페이지가 되어
// 인쇄 대화상자에서 "용지보다 큰 페이지"로 뜬다. A4에 맞춤 인쇄하면 164×297mm.
const PAGE_W_MM = 140;
const MM = PAGE_W_MM / W; // px → mm
const IMAGE_QUALITY = 0.95;
const PAPER = "#fbf6ec";
const INK = "#4a3f35";
const INK_SOFT = "#7a6a58";
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

/** 고해상도 캔버스. 좌표는 원래 크기(w × h) 기준으로 쓴다. */
function textCanvas(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w * TEXT_SCALE;
  canvas.height = h * TEXT_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF 페이지를 그릴 수 없어요.");
  ctx.scale(TEXT_SCALE, TEXT_SCALE);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  return { canvas, ctx };
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
  return canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
}

// 삽화 아래 글 영역 → 고해상도 PNG
function renderCaption(page: PdfPage, pageNum: number): string {
  const { canvas, ctx } = textCanvas(W, CAP_H);
  ctx.fillStyle = INK;

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
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(`— ${pageNum} —`, W / 2, CAP_H - 32);
  }

  return canvas.toDataURL("image/png");
}

const COLOPHON_H = 640;

// 맨 뒤 판권 페이지의 글 — 페이지 가운데 띠 하나만 고해상도로 그린다(전면을 3배로 그리면 폰 메모리가 위험)
function renderColophon(title: string, meta: PdfMeta): string {
  const { canvas, ctx } = textCanvas(W, COLOPHON_H);
  const d = new Date();
  const date = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  const forWhom = meta.kidsInfo?.trim();

  let y = 150;
  ctx.fillStyle = INK_SOFT;
  ctx.font = `26px ${FONT}`;
  ctx.fillText("✦", W / 2, y);

  y += 70;
  ctx.fillStyle = INK;
  ctx.font = `700 40px ${FONT}`;
  const titleLines = wrapText(ctx, `《 ${title} 》`, W - 200);
  titleLines.forEach((line, i) => ctx.fillText(line, W / 2, y + i * 56));
  y += titleLines.length * 56 + 30;

  ctx.font = `30px ${FONT}`;
  if (forWhom) {
    ctx.fillText(`${forWhom}를 위해 만든 이야기`, W / 2, y);
    y += 52;
  }
  ctx.fillText(date, W / 2, y);

  y += 90;
  ctx.fillStyle = INK_SOFT;
  ctx.font = `22px ${FONT}`;
  ctx.fillText(
    "삽화는 아이의 사진을 참고해 AI가 새로 그린 그림입니다.",
    W / 2,
    y,
  );
  y += 36;
  ctx.fillText("키즈북 · story.kidstel.co.kr", W / 2, y);

  return canvas.toDataURL("image/png");
}

export async function downloadStoryPdf(
  title: string,
  pages: PdfPage[],
  meta: PdfMeta = {},
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  // 폰트가 로드된 뒤 캔버스에 그려야 명조체가 적용됨
  if (document.fonts?.ready) await document.fonts.ready;

  const doc = new jsPDF({
    unit: "mm",
    format: [W * MM, PAGE_H * MM],
    orientation: "portrait",
    compress: true,
  });
  doc.setProperties({
    title,
    subject: "우리 아이가 주인공인 동화책",
    author: "키즈북",
    creator: "키즈북 story.kidstel.co.kr",
  });

  const total = pages.length + 1; // 판권 페이지까지
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) doc.addPage([W * MM, PAGE_H * MM], "portrait");
    const page = pages[i];
    if (page.image) {
      doc.addImage(
        await renderImage(page.image),
        "JPEG",
        0,
        0,
        W * MM,
        IMG_H * MM,
      );
    } else {
      doc.setFillColor(PAPER);
      doc.rect(0, 0, W * MM, IMG_H * MM, "F");
    }
    // 표지=0, 장면은 1부터. 고해상도 PNG를 종이 크기로 넣으면 PDF 안에서 그 해상도로 남는다
    doc.addImage(
      renderCaption(page, i),
      "PNG",
      0,
      IMG_H * MM,
      W * MM,
      CAP_H * MM,
    );
    onProgress?.(i + 1, total);
  }

  // 판권 페이지
  doc.addPage([W * MM, PAGE_H * MM], "portrait");
  doc.setFillColor(PAPER);
  doc.rect(0, 0, W * MM, PAGE_H * MM, "F");
  doc.addImage(
    renderColophon(title, meta),
    "PNG",
    0,
    ((PAGE_H - COLOPHON_H) / 2) * MM,
    W * MM,
    COLOPHON_H * MM,
  );
  onProgress?.(total, total);

  const safe = title.replace(/[\\/:*?"<>|]/g, "").trim() || "동화책";
  doc.save(`${safe}.pdf`);
}
