import type { MetadataRoute } from "next";

// Serve a real robots.txt so crawlers don't 404 (or, worse, get redirected
// to HTML). The API routes spend money per request — keep bots out of them.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
  };
}
