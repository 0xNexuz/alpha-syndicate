import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/oracle": "http://localhost:8787",
      "/payments": "http://localhost:8787",
      "/agent": "http://localhost:8787"
    }
  }
});
