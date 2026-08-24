import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Integration tests run against LIVE emulators. Start them first:
//   npm run dev:emulators   (then npm run seed)
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    testTimeout: 25000,
    hookTimeout: 25000,
    fileParallelism: false,
  },
})
