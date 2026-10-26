import type { NextConfig } from "next";

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      // Everything except the embed may only be framed by ourselves.
      {
        source: "/((?!embed).*)",
        headers: [...baseHeaders, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
      // /embed gets its frame-ancestors policy from src/proxy.ts (EMBED_ALLOWED_ORIGINS, read at runtime).
      { source: "/embed", headers: baseHeaders },
      { source: "/embed.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=3600" }] },
    ];
  },
};

export default config;
