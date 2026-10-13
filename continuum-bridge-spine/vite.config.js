import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 45173,
    strictPort: true
  },
  // Serving the built app (SERVE=built in the cloud): answer on its public address, whatever its name
  preview: {
    allowedHosts: true
  }
})
