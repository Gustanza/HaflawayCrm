import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/**
 * View mount tests. Separate config because these need jsdom and the Vue plugin, while the
 * domain suite runs in plain node with a pinned timezone.
 * Run: npm run test:views
 */
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['tests/views/**/*.test.js'],
    env: { TZ: 'America/New_York' },
  },
})
