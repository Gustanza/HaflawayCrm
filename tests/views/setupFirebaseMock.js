/**
 * Global Firebase mock for the view-mount suite.
 *
 * These tests exist to catch "it compiles but throws at mount" (TODO.legacy.md B38) — a
 * component can be perfectly correct Vue and still explode the moment it touches a real
 * Firestore/Auth SDK in jsdom (no IndexedDB, no network). So every view under test runs
 * against these fakes instead, never a real backend or emulator. Mounting must exercise the
 * SAME code paths as production (real stores, real composables, real query builders) —
 * only the SDK boundary itself is replaced.
 */
import { vi } from 'vitest'

function fakeSnapshot(docs = []) {
  return {
    docs: docs.map((d, i) => ({
      id: d.id ?? `doc-${i}`,
      data: () => d,
      exists: () => true,
    })),
    size: docs.length,
    empty: docs.length === 0,
    metadata: { fromCache: false, hasPendingWrites: false },
  }
}

vi.mock('@/firebase/app.js', () => ({
  app: {},
  auth: {},
  USING_EMULATORS: false,
  getDb: vi.fn().mockResolvedValue({}),
  dbOrNull: () => ({}),
  getStorageInstance: vi.fn().mockResolvedValue({}),
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  deleteApp: vi.fn().mockResolvedValue(undefined),
  getApp: vi.fn(() => ({})),
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  collectionGroup: vi.fn(() => ({})),
  doc: vi.fn(() => ({ id: 'mock-doc-id' })),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  startAfter: vi.fn(() => ({})),
  onSnapshot: vi.fn((_q, optsOrNext, maybeNext) => {
    const onNext = typeof optsOrNext === 'function' ? optsOrNext : maybeNext
    onNext?.(fakeSnapshot([]))
    return () => {}
  }),
  getDocs: vi.fn().mockResolvedValue(fakeSnapshot([])),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined, id: 'mock-doc-id' }),
  setDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  serverTimestamp: vi.fn(() => new Date('2026-08-24T09:00:00Z')),
  runTransaction: vi.fn(async (_db, fn) =>
    fn({
      get: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
      set: vi.fn(),
      update: vi.fn(),
    }),
  ),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  })),
  arrayUnion: vi.fn((v) => v),
  increment: vi.fn((n) => n),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  onAuthStateChanged: vi.fn((_auth, next) => {
    next(null)
    return () => {}
  }),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  updatePassword: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
}))
