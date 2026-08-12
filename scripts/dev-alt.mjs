// 보조 dev 서버 — 다른 세션이 이미 3466을 쓰고 있을 때 사용.
// 빌드 폴더를 갈라서 원래 서버의 .next 캐시를 건드리지 않는다.
// 실행: node scripts/dev-alt.mjs [포트] [빌드폴더]   (기본 3566 · .next-alt)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.argv[2] || "3566";
const distDir = process.argv[3] || ".next-alt";

spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", root, "-p", port], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: distDir },
}).on("exit", (code) => process.exit(code ?? 0));
