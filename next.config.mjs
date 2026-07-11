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
  // silences the workspace-root warning: without this, Turbopack walks up looking for
  // lockfiles and picks up an unrelated one at /Users/desmat/yarn.lock, several directories
  // above this project
  turbopack: {
    root: import.meta.dirname,
  },
  env: {
    IMPERSONATE_USER_ID: process.env.IMPERSONATE_USER_ID,
    IMPERSONATE_USER_IS_ADMIMN: process.env.IMPERSONATE_USER_IS_ADMIMN,
    // read in client code by lib/upload.ts to fake blob uploads in tests
    BLOB_MOCK: process.env.BLOB_MOCK,
    // surfaced in the sidebar logo's tooltip in admin mode -- see components/app-sidebar.tsx
    GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || gitInfo("%H"),
    GIT_COMMIT_DATE: gitInfo("%cI"),
  }
};

export default nextConfig;
