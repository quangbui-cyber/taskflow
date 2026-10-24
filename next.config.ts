import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Keep generated manifests out of macOS File Provider sync. Partial syncs can
  // make the dev server repeatedly invalidate and rebuild the current route.
  // Vercel's Next.js builder expects the standard .next artifact directory.
  // Keep the non-synced directory only for local macOS development/builds.
  distDir: process.env.TASKFLOW_DIST_DIR || (process.env.VERCEL === "1" ? ".next" : ".next.nosync"),
  outputFileTracingIncludes: {
    "/api/projects/*/costflow/customer-acceptance/pdf": ["./node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"],
  },
  serverExternalPackages: ["nodemailer"],
  experimental: {
    serverActions: {
      bodySizeLimit: "4.2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/api/projects/:id/costflow/evidence/:evidenceId/preview",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
