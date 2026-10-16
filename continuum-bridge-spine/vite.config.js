import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// https://vite.dev/config/
// The image's build (scripts/runtime-env.mjs build) names the VITE_ settings
// given only when the app starts: each reads from the object the page's
// runtime-env.js fills in, instead of being written into the code now
const atStart = process.env.CONTINUUM_RUNTIME_ENV ? JSON.parse(process.env.CONTINUUM_RUNTIME_ENV) : []

export default defineConfig({
  plugins: [react()],
  // Shown as the app's version in the profile menu and in support details
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    ...Object.fromEntries(atStart.map((n) => [`import.meta.env.${n}`, `globalThis.__CONTINUUM_ENV__.${n}`])),
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
