import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite configuration file
// This tells Vite how to build your project and that you're using React
export default defineConfig({
  plugins: [react()],
})
