import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // '@/' key (not bare '@') so scoped npm packages like @tanstack are untouched.
    alias: { '@/': `${path.resolve(process.cwd(), 'src')}/` },
  },
  server: { host: true, port: 5173 },
})
