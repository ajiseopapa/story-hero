// 대표 도메인은 kidsbook-story.vercel.app. 예전 주소로 들어오면 경로를 유지한 채 308로 넘긴다.
const PRIMARY_HOST = "kidsbook-story.vercel.app";
const LEGACY_HOSTS = ["my-storybook-kr.vercel.app", "story-hero-flame.vercel.app"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 여러 세션이 이 폴더를 동시에 쓴다. 두 dev 서버가 같은 .next를 공유하면 양쪽 다 깨지므로,
  // 두 번째 서버는 NEXT_DIST_DIR로 빌드 폴더를 갈라서 띄운다. (배포에는 영향 없음)
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // 이미지 base64 payload가 크므로 서버 액션/라우트 바디 제한 여유있게
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  // OG 이미지 라우트가 폰트 파일을 fs로 읽으므로 번들에 확실히 포함시킨다
  outputFileTracingIncludes: {
    "/opengraph-image": ["./assets/fonts/**"],
  },
  async redirects() {
    return LEGACY_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: `https://${PRIMARY_HOST}/:path*`,
      permanent: true,
    }));
  },
};

export default nextConfig;
