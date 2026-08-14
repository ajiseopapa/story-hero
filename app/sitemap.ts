import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/sharebook";

// 검색엔진에 알릴 공개 페이지 목록. /book/{id}는 noindex 공유 링크라 넣지 않고,
// /admin·/api는 robots에서 이미 막거나 색인 대상이 아니다.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_ORIGIN}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_ORIGIN}/samples`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_ORIGIN}/refund`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_ORIGIN}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_ORIGIN}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
