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
    // The default 5000ms is comfortable for any one file alone, but this suite mounts many
    // real Vue components with live useNow()/useCollection() composables across several
    // files run in the same worker — cumulative jsdom + reactivity teardown overhead can
    // push a single test past 5s in the FULL combined run even though nothing is actually
    // hung (every file completes in a few seconds when run in isolation).
    testTimeout: 15000,
  },
})
