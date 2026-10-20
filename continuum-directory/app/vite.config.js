import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// continuum-directory-app: the Directory's page, on its own address
// (locally http://localhost:45194). The image's build (scripts/runtime-env.mjs
// build) names the VITE_ settings given only when the app starts: each reads
// from the object the page's runtime-env.js fills in.
const atStart = process.env.CONTINUUM_RUNTIME_ENV ? JSON.parse(process.env.CONTINUUM_RUNTIME_ENV) : []

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    ...Object.fromEntries(atStart.map((n) => [`import.meta.env.${n}`, `globalThis.__CONTINUUM_ENV__.${n}`])),
  },
  server: {
    port: 45194,
    strictPort: true
  },
  // Serving the built app (SERVE=built in the cloud): answer on its public address, whatever its name
  preview: {
    port: 45194,
    allowedHosts: true
  }
})
