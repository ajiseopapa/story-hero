// 대표 도메인은 story.kidstel.co.kr. 예전 주소로 들어오면 경로를 유지한 채 308로 넘긴다.
// 주의: 옛 주소(kidsbook-story 등)에서 책을 만든 사용자의 IndexedDB는 origin별이라
// 리다이렉트로 넘어와도 책이 보이지 않는다 — 이전 공지가 필요하면 별도 처리.
const PRIMARY_HOST = "story.kidstel.co.kr";
const LEGACY_HOSTS = [
  "kidsbook-story.vercel.app",
  "my-storybook-kr.vercel.app",
  "story-hero-flame.vercel.app",
];

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
    return [
      ...LEGACY_HOSTS.map((host) => ({
        source: "/:path*",
        has: [{ type: "host", value: host }],
        destination: `https://${PRIMARY_HOST}/:path*`,
        permanent: true,
      })),
      // 인스타 프로필용 짧은 주소 → UTM 붙은 홈으로. GA 트래픽 획득에서 campaign으로 갈린다.
      // 307(임시)로 둔다 — 308로 캐시되면 나중에 UTM을 바꿔도 브라우저가 옛 주소를 기억한다.
      {
        source: "/papa",
        destination: "/?utm_source=instagram&utm_medium=reels&utm_campaign=papa",
        permanent: false,
      },
      {
        source: "/mama",
        destination: "/?utm_source=instagram&utm_medium=reels&utm_campaign=mama",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
