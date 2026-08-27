import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Integration tests run against LIVE emulators. Start them first:
//   npm run dev:emulators   (then npm run seed)
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    /**
     * FORCED ON, and not negotiable from .env.local.
     *
     * These tests import `@/firebase/app.js`, which decides between the emulator and the
     * real project from VITE_USE_EMULATORS. Anyone who flips that to `false` to point the
     * dev server at live Firebase would otherwise silently re-aim this whole suite at
     * PRODUCTION - and it writes campaigns, which `firestore.rules` forbids deleting.
     * Overriding it here means the integration suite can only ever hit 127.0.0.1.
     */
    env: { VITE_USE_EMULATORS: 'true' },
    setupFiles: ['./tests/integration/guard.js'],
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    testTimeout: 25000,
    hookTimeout: 25000,
    fileParallelism: false,
  },
})
