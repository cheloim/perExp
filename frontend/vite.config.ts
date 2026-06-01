import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://host.docker.internal:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/notifications': {
        target: 'http://host.docker.internal:8000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://host.docker.internal:8000',
        changeOrigin: true,
      },
    },
  },
})
