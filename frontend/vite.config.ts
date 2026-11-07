import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { validateApiBaseUrl } from './build/api-url'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  define: command === 'build' ? {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(validateApiBaseUrl(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL)),
  } : {},
  server: {
    host: true,
    watch: {
      usePolling: true,
    },
  },
}))
