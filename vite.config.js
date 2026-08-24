import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    /**
     * Without a service worker the app only survives offline inside a single live tab.
     * An agent who force-closes Chrome — or whose tab is evicted, which is routine on a
     * 2 GB Android phone — gets the offline dinosaur instead of the CRM. TODO.md P8 says
     * offline is the NORMAL case, so the app shell has to be precached.
     */
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Haflaway CRM',
        short_name: 'Haflaway',
        description: 'Simamia wateja wako — Haflaway CRM',
        lang: 'sw',
        theme_color: '#312e81',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The Firestore chunk alone is ~535 KB raw; the default 2 MB cap would silently
        // drop it from the precache and the app would still fail to boot offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // Never let the SW intercept Firebase traffic: the SDK does its own offline
        // queueing, and a cached auth or Firestore response would be actively harmful.
        navigateFallbackDenylist: [/^\/__/, /\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 10 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // NO hand-written Firebase chunk groups.
    //
    // An earlier revision split @firebase/firestore into its own group for caching. That
    // grouping HOISTED initializeApp() into the firestore chunk, which made the auth chunk
    // statically import it — defeating the `await import('firebase/firestore')` in
    // firebase/app.js and putting 164 KB of Firestore back on the login path. The source
    // was correct and the bundle was not.
    //
    // Rolldown's own dynamic-import splitting gets this right. `npm run check:bundle`
    // asserts it against the built output, because reading the source cannot prove it.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [{ name: 'vendor', test: /node_modules[\/](vue|pinia|@intlify)/ }],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    globals: false,
    // Pin the test timezone to one that is NOT UTC+3 and DOES observe DST.
    //
    // Development machines here run Africa/Nairobi, which shares Dar es Salaam's offset.
    // That made every timezone bug in src/domain/periods.js invisible: a broken 23-hour
    // "org day" passed a test asserting it was exactly 24 hours, purely because the host
    // clock happened to agree. Pinning to New York means the suite exercises the case the
    // code actually has to survive — a manager travelling, or a browser set to another zone.
    env: { TZ: 'America/New_York' },
  },
})
