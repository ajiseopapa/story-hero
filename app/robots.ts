import type { MetadataRoute } from "next";

// 관리 화면은 키가 없으면 아무것도 안 보이지만, 애초에 검색에 걸릴 이유가 없다.
// /book/{id} 공유 링크는 각 페이지에서 noindex를 달고 있어 여기서 또 막지 않는다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/admin" },
  };
}
