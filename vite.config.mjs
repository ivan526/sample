import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_DEV_API_TARGET || "http://127.0.0.1:8787";
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || "terminal.local,localhost")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const proxy = {
    "/api": {
      target: apiTarget,
      changeOrigin: true,
    },
  };

  return {
    build: {
      outDir: "dist/client",
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      port: Number(env.VITE_DEV_PORT || 5173),
      allowedHosts,
      proxy,
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    preview: {
      host: "0.0.0.0",
      port: Number(env.VITE_PREVIEW_PORT || 4173),
      allowedHosts,
      proxy,
    },
    plugins: [react()],
  };
});
