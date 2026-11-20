import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "react-dom/client": fileURLToPath(
        new URL("./node_modules/react-dom/client.js", import.meta.url),
      ),
      "react/jsx-dev-runtime": fileURLToPath(
        new URL("./node_modules/react/jsx-dev-runtime.js", import.meta.url),
      ),
      "react/jsx-runtime": fileURLToPath(
        new URL("./node_modules/react/jsx-runtime.js", import.meta.url),
      ),
      react: fileURLToPath(
        new URL("./node_modules/react/index.js", import.meta.url),
      ),
    },
  },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
    fs: { allow: [fileURLToPath(new URL("../../../../", import.meta.url))] },
  },
});
