import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tfrrsData } from './tools/tfrrs-data.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tfrrsData()],
})
