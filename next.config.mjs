import { execSync } from "node:child_process";

// best-effort: absent (e.g. a git-less deploy artifact) shouldn't fail the build
function gitInfo(format) {
  try {
    return execSync(`git log -1 --format=${format}`).toString().trim();
  } catch {
    return "";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    IMPERSONATE_USER_ID: process.env.IMPERSONATE_USER_ID,
    IMPERSONATE_USER_IS_ADMIMN: process.env.IMPERSONATE_USER_IS_ADMIMN,
    // surfaced in the sidebar logo's tooltip in admin mode -- see components/app-sidebar.tsx
    GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || gitInfo("%H"),
    GIT_COMMIT_DATE: gitInfo("%cI"),
  }
};

export default nextConfig;
