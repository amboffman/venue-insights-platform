import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Resolve the `@/*` -> `./src/*` alias from tsconfig.json natively
  // (Vite 4+ supersedes the vite-tsconfig-paths plugin).
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
