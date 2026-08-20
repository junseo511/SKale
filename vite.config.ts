import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pagesBasePath = process.env.GITHUB_PAGES_BASE_PATH
const base =
  pagesBasePath && pagesBasePath !== '/' && pagesBasePath !== '.'
    ? `${pagesBasePath}/`
    : '/'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base,
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
