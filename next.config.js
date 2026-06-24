/** @type {import('next').NextConfig} */
const electronExport = process.env.ELECTRON_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module; keep it external to the server bundle.
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
  // For the Electron build we ship a static export loaded over file:// and serve
  // data via IPC. Trailing slashes make client routes resolve to index.html
  // files, and image optimization must be disabled without a server.
  ...(electronExport
    ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
    : {}),
};

module.exports = nextConfig;
