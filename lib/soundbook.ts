// "소리책" 내보내기 — 그림+글+음성이 전부 들어있는 단일 HTML 파일 생성.
// 인터넷 없이 더블클릭만으로 열리고, 카톡 등으로 가족에게 공유 가능.

type SoundPage = {
  kind: "cover" | "scene";
  text: string;
  image: string | null; // data URL
  audio: string | null; // data URL (mp3/webm) — 없으면 소리 없이 넘김
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSoundBookHtml(title: string, pages: SoundPage[]): string {
  const data = JSON.stringify(
    pages.map((p) => ({ k: p.kind, t: p.text, i: p.image, a: p.audio })),
  ).replace(/</g, "\\u003c"); // 본문에 "</script>"류 문자열이 있어도 스크립트가 안 깨지게

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — 소리책</title>
<style>
  :root {
    --paper: #f7efe2; --paper-2: #fbf6ec; --ink: #3a2e22; --ink-soft: #7a6a58;
    --accent: #e08a7b; --gold: #e3b15f; --shadow: rgba(74,63,53,.18);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "Nanum Myeongjo", "Malgun Gothic", serif; color: var(--ink);
    background: radial-gradient(circle at 20% 15%, #fbf6ec 0%, var(--paper) 55%, #efe3cf 100%);
    min-height: 100dvh;
  }
  .wrap { max-width: 560px; margin: 0 auto; padding: 20px 16px 48px; }
  h1 { text-align: center; font-size: clamp(22px, 5vw, 30px); font-weight: 800; margin: 10px 0 16px; }
  .page {
    background: var(--paper-2); border: 1px solid #e8dcc6; border-radius: 20px;
    overflow: hidden; box-shadow: 0 18px 44px -22px var(--shadow);
  }
  .illus { width: 100%; aspect-ratio: 1024/1536; background: #efe6d5; }
  .illus img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .caption {
    padding: 18px 20px 22px; font-size: clamp(17px, 3.8vw, 20px); font-weight: 700;
    line-height: 1.85; text-align: center; word-break: keep-all; min-height: 60px;
  }
  .cover-note { text-align: center; color: var(--accent); font-size: 14px; padding: 12px; }
  .controls { display: flex; gap: 10px; margin-top: 14px; align-items: center; justify-content: space-between; }
  button {
    border: 1.5px solid #ddceb3; background: #fff; color: var(--ink); cursor: pointer;
    font-family: inherit; font-size: 16px; font-weight: 700; padding: 11px 16px; border-radius: 12px;
  }
  button:disabled { opacity: .4; cursor: not-allowed; }
  .play {
    flex: 1; border: none; color: #fff; font-size: 18px;
    background: linear-gradient(135deg, #a8bd96, #9bb08a 60%, #8ba37a);
  }
  .play.on { background: linear-gradient(135deg, #d35c4c, #c0392b); }
  .pagenum { text-align: center; color: var(--ink-soft); font-size: 14px; margin-top: 12px; }
  .no-audio { text-align: center; color: var(--ink-soft); font-size: 13px; margin-top: 8px; min-height: 18px; }
  .foot { text-align: center; color: var(--ink-soft); font-size: 12px; margin-top: 28px; line-height: 1.7; }
</style>
</head>
<body>
<div class="wrap">
  <h1>《 ${esc(title)} 》</h1>
  <div class="page">
    <div class="illus"><img id="img" alt="삽화" /></div>
    <div class="caption" id="cap"></div>
  </div>
  <div class="pagenum" id="num"></div>
  <div class="no-audio" id="note"></div>
  <div class="controls">
    <button id="prev">← 이전</button>
    <button id="play" class="play">▶ 여기부터 읽어주기</button>
    <button id="next">다음 →</button>
  </div>
  <div class="foot">우리 아이가 주인공 · 소리책<br/>파일 하나에 그림과 목소리가 모두 담겨 있어요 💛</div>
</div>
<script>
  var PAGES = ${data};
  var cur = 0, playing = false, audio = new Audio();
  var img = document.getElementById("img"), cap = document.getElementById("cap"),
      num = document.getElementById("num"), note = document.getElementById("note"),
      playBtn = document.getElementById("play");

  function show(i) {
    cur = Math.max(0, Math.min(PAGES.length - 1, i));
    var p = PAGES[cur];
    if (p.i) img.src = p.i;
    cap.textContent = p.k === "cover" ? "✦ " + p.t + " ✦" : p.t;
    num.textContent = (cur + 1) + " / " + PAGES.length;
    note.textContent = p.a ? "" : "이 페이지는 녹음된 소리가 없어요";
    document.getElementById("prev").disabled = cur === 0;
    document.getElementById("next").disabled = cur === PAGES.length - 1;
  }

  function stop() {
    playing = false;
    audio.pause();
    playBtn.textContent = "▶ 여기부터 읽어주기";
    playBtn.classList.remove("on");
  }

  function playFrom(i) {
    playing = true;
    playBtn.textContent = "⏹ 그만 읽기";
    playBtn.classList.add("on");
    (function step(j) {
      if (!playing) return;
      if (j >= PAGES.length) { stop(); return; }
      show(j);
      var p = PAGES[j];
      if (!p.a) { setTimeout(function () { step(j + 1); }, 2500); return; }
      audio.src = p.a;
      audio.onended = function () { if (playing) step(j + 1); };
      audio.play().catch(stop);
    })(i);
  }

  playBtn.onclick = function () { playing ? stop() : playFrom(cur); };
  document.getElementById("prev").onclick = function () { stop(); show(cur - 1); };
  document.getElementById("next").onclick = function () { stop(); show(cur + 1); };
  show(0);
</script>
</body>
</html>`;
}

// Blob → data URL
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function downloadSoundBook(title: string, pages: SoundPage[]): void {
  const html = buildSoundBookHtml(title, pages);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title} 소리책.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
