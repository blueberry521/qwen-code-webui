import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/**/*.spec.ts"],
    testTimeout: 30000,
  },
});
