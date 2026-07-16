/** @type {import('next').NextConfig} */
const nextConfig = {
  // 이미지 base64 payload가 크므로 서버 액션/라우트 바디 제한 여유있게
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
