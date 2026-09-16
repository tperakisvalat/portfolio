import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite configuration file
// This tells Vite how to build your project and that you're using React
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/news': 'http://127.0.0.1:8787',
      '/news/brief.txt': 'http://127.0.0.1:8787',
    },
  },
})
