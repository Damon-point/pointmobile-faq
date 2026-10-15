import type { NextConfig } from "next";

// 화면과 API(src/app/api/**/route.ts)가 한 앱이다 — 따로 띄우는 백엔드가 없다.
const nextConfig: NextConfig = {
  // postgres · nodemailer 는 Node 전용 — 번들에 넣지 않고 런타임에 불러온다.
  serverExternalPackages: ["postgres", "nodemailer"],
};

export default nextConfig;
