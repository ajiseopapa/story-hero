"use client";

// 관리자 키 취급 규칙 (주문·퍼널·후기 화면이 같이 쓴다):
// - API에는 x-admin-key 헤더로만 보낸다. 쿼리스트링에 실으면 액세스 로그·브라우저
//   히스토리·(외부 링크 클릭 시) Referer에 키가 그대로 남는다.
// - 예전 즐겨찾기(?key=...)로 들어오면 sessionStorage로 옮기고 주소에서 지운다.
import { useEffect, useState } from "react";

const STORE = "kidsbook-admin-key";

export function useAdminKey(): [string, (k: string) => void] {
  const [key, setKeyState] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("key");
    if (fromUrl) {
      sessionStorage.setItem(STORE, fromUrl);
      url.searchParams.delete("key");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    setKeyState(fromUrl ?? sessionStorage.getItem(STORE) ?? "");
  }, []);

  const setKey = (k: string) => {
    sessionStorage.setItem(STORE, k);
    setKeyState(k);
  };

  return [key, setKey];
}
