import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { tfrrsData } from './tools/tfrrs-data.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tfrrsData()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.jsx'],
  },
})
