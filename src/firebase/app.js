/**
 * Firebase initialisation.
 *
 * TODO.md P8: the local cache IS the database; the network is a sync detail. Firestore is
 * therefore created with a persistent IndexedDB cache and the multi-tab manager, so an
 * agent who loses signal at a committee meeting keeps full read/write access.
 *
 * FIRESTORE IS LOADED LAZILY, and that is deliberate. The SDK is ~158 KB gzipped — by far
 * the largest thing we ship — and the signed-out routes do not touch a database. Importing
 * it eagerly put the whole app over the 250 KB budget in §15 before a single feature
 * existed, and made an agent on 3G wait for it just to see a login form.
 *
 * Call `getDb()` (async) from anything that runs after sign-in. `db` remains available as a
 * synchronous export for code already inside the authenticated app, where the module has
 * certainly been loaded — but prefer `getDb()` in new code.
 *
 * In development we connect to the Emulator Suite. Production data is never touched from a
 * dev build (TODO.md Phase 0).
 */

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
  measurementId: import.meta.env.VITE_FB_MEASUREMENT_ID,
}

// Fail loudly at boot rather than mysteriously at the first query. main.js catches this
// and renders a human message instead of a blank page.
const missing = Object.entries(firebaseConfig)
  .filter(([key, value]) => key !== 'measurementId' && !value)
  .map(([key]) => key)

if (missing.length) {
  throw new Error(
    `Firebase config incomplete — missing: ${missing.join(', ')}. ` +
      'Copy .env.example to .env.local and fill in the values from the Firebase console.',
  )
}

export const app = initializeApp(firebaseConfig)

/** True when this build talks to the Emulator Suite instead of production. */
export const USING_EMULATORS =
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS !== 'false'

/* ------------------------------------------------------------------ Auth (eager) */
// Auth is small and every route needs it to decide whether the user is signed in.

export const auth = getAuth(app)

if (USING_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  // eslint-disable-next-line no-console
  console.info(
    '%c[Haflaway CRM] Connected to Firebase EMULATORS — production data is untouched.',
    'color:#0a7; font-weight:bold',
  )
}

/* -------------------------------------------------------------- Firestore (lazy) */

let dbPromise = null
let dbInstance = null

/**
 * Load and initialise Firestore. Idempotent, and safe to call concurrently — the promise
 * is memoised, so ten callers on one page produce one initialisation.
 */
export function getDb() {
  if (dbInstance) return Promise.resolve(dbInstance)
  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    const {
      initializeFirestore,
      persistentLocalCache,
      persistentMultipleTabManager,
      connectFirestoreEmulator,
    } = await import('firebase/firestore')

    // `persistentMultipleTabManager` lets an agent keep the app open in two tabs without
    // one of them silently losing offline persistence.
    const instance = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })

    if (USING_EMULATORS) {
      connectFirestoreEmulator(instance, '127.0.0.1', 8080)
    }

    dbInstance = instance
    return instance
  })()

  return dbPromise
}

/** Synchronous handle. Null until getDb() has resolved at least once. */
export function dbOrNull() {
  return dbInstance
}

let storagePromise = null

/** Cloud Storage, lazily — only the attachment and receipt flows need it. */
export function getStorageInstance() {
  if (storagePromise) return storagePromise
  storagePromise = (async () => {
    const { getStorage, connectStorageEmulator } = await import('firebase/storage')
    const instance = getStorage(app)
    if (USING_EMULATORS) connectStorageEmulator(instance, '127.0.0.1', 9199)
    return instance
  })()
  return storagePromise
}
