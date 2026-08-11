// 카톡·SNS에 첫 화면 주소를 붙였을 때 뜨는 미리보기 카드.
// 한글이 나와야 해서 브랜드 손글씨체(Gaegu, OFL)를 직접 실어 그린다.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "키즈북 — 우리 아이가 주인공인 그림동화";

// 겹쳐 쌓인 동화책 장식 (맨 뒤 → 맨 앞)
const BOOKS = [
  { color: "#a8bd96", left: 40, top: 60, rotate: "-8deg" },
  { color: "#e3b15f", left: 20, top: 30, rotate: "-3deg" },
  { color: "#e79a86", left: 0, top: 0, rotate: "4deg" },
];

export default async function OpengraphImage() {
  const gaegu = await readFile(join(process.cwd(), "assets/fonts/Gaegu-Bold.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 80px",
          background: "linear-gradient(135deg, #fbf6ec 0%, #f7efe2 55%, #efe3cf 100%)",
          color: "#4a3f35",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, maxWidth: 670 }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              border: "3px dashed #e08a7b",
              color: "#e08a7b",
              borderRadius: 999,
              padding: "6px 28px",
              fontSize: 34,
              marginBottom: 28,
            }}
          >
            키즈북
          </div>
          <div style={{ fontSize: 66, lineHeight: 1.35, marginBottom: 18 }}>
            우리 아이가 주인공인
            <br />
            그림동화
          </div>
          <div style={{ fontSize: 35, color: "#7a6a58", lineHeight: 1.5 }}>
            사진과 이름을 넣으면 아이를 닮은 수채화 동화책이 됩니다
          </div>
          <div style={{ fontSize: 28, color: "#a99a85", marginTop: 30 }}>
            kidsbook-story.vercel.app
          </div>
        </div>

        <div style={{ display: "flex", position: "relative", width: 380, height: 470 }}>
          {BOOKS.map((book, i) => (
            <div
              key={book.color}
              style={{
                display: "flex",
                position: "absolute",
                left: book.left,
                top: book.top,
                width: 300,
                height: 400,
                borderRadius: 20,
                background: book.color,
                border: "10px solid #fffdf8",
                transform: `rotate(${book.rotate})`,
              }}
            >
              {/* 맨 위 책에만 책등과 제목 자리를 넣어 '책'처럼 보이게 */}
              {i === BOOKS.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    left: 22,
                    top: 0,
                    width: 8,
                    height: "100%",
                    background: "rgba(255,255,255,0.45)",
                  }}
                />
              )}
              {i === BOOKS.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    left: 60,
                    top: 150,
                    width: 190,
                    height: 92,
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.55)",
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Gaegu", data: gaegu, style: "normal", weight: 700 }],
    },
  );
}
