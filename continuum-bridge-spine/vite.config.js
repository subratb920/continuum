import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Shown as the app's version in the profile menu and in support details
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  server: {
    port: 45173,
    strictPort: true
  },
  // Serving the built app (SERVE=built in the cloud): answer on its public address, whatever its name
  preview: {
    allowedHosts: true
  }
})
