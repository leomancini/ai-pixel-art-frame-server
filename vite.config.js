import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev (`npm run dev`, port 5173) proxy the API + device endpoints to the
// Express server on 3136 so same-origin cookies and the GIS button work.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3136",
      "/animation": "http://localhost:3136",
      "/poll": "http://localhost:3136",
    },
  },
});
