// 대표 도메인은 kidsbook-story.vercel.app. 예전 주소로 들어오면 경로를 유지한 채 308로 넘긴다.
const PRIMARY_HOST = "kidsbook-story.vercel.app";
const LEGACY_HOSTS = ["my-storybook-kr.vercel.app", "story-hero-flame.vercel.app"];

/** @type {import('next').NextConfig} */
const nextConfig = {
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
