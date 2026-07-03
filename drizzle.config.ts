import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, which is what loads .env.local normally.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Only needed by `drizzle-kit migrate` / `studio`; `generate` is offline.
    url: process.env.DATABASE_URL ?? "",
  },
});
