import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dashboard was promoted to the homepage; old /dashboard links
  // (PR bodies, bookmarks) keep working. Temporary (307) so the route
  // stays reclaimable.
  async redirects() {
    return [{ source: "/dashboard", destination: "/", permanent: false }];
  },
};

export default nextConfig;
