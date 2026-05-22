/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, ".."), "");
  const apiPort = env.PORT || "8080";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "../shared"),
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/react-router-dom")) return "vendor";
            if (id.includes("node_modules/@headlessui") || id.includes("node_modules/@heroicons")) return "ui";
            if (id.includes("node_modules/react-diff-viewer-continued")) return "diff";
          },
        },
      },
    },
    server: {
      port: 3000,
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          secure: false,
        },
        "/vscode": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      globals: true,
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/cypress/**",
        "**/.{idea,git,cache,output,temp}/**",
        "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
        "**/scripts/**", // Exclude Playwright demo recording files
        "**/tests/**", // Exclude Playwright validation tests
      ],
    },
  };
});
