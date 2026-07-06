import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'notifications.worker': path.resolve(__dirname, 'src/workers/notifications.worker.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["oikonomia.ar", "www.oikonomia.ar", "platform.oikonomia.ar"],
    proxy: {
      '/api': {
        target: 'http://backend_dev:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/notifications': {
        target: 'http://backend_dev:8000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://backend_dev:8000',
        changeOrigin: true,
      },
      '/budgets': {
        target: 'http://backend_dev:8000',
        changeOrigin: true,
      },
    },
  },
})
