import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // VITE_* vars live in the repo-root .env; other vars in it (the API key) are never exposed
  envDir: "..",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000" },
    // mock mode imports fixtures from ../contracts
    fs: { allow: [".."] },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
