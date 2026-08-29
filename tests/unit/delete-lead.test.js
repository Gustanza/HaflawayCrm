/**
 * `deleteLead()` — the only irreversible operation in the product.
 *
 * Driven against a fake Firestore that keeps a REAL store and an ordered operation log, so
 * these assert the things that actually go wrong with a cascade rather than that the
 * function was called:
 *
 *   · order — children before the parent, because the rules gate a child delete on the
 *     parent existing. Getting this backwards strands documents nothing can ever remove.
 *   · completeness — Firestore does not cascade; every subcollection must be walked empty,
 *     including one longer than a single batch.
 *   · the phone lock — released when it belongs to this lead, left alone when it does not.
 *   · the tombstone — written BEFORE the destruction, so a half-failed run is still
 *     explainable, and carrying no PII.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ------------------------------------------------------------ the fake store */

/** collectionPath -> Set of document ids. */
let store
/** Every operation, in order: 'setDoc leadDeletions/l1', 'delete leads/l1/activities/a3'… */
let log
/** leadPhoneIndex doc id -> data, or null for "does not exist". */
let phoneIndex

const pathOf = (segments) => segments.join('/')

vi.mock('@/firebase/app.js', () => ({ getDb: async () => ({ fake: true }) }))

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...segments) => ({ __collection: pathOf(segments) }),
  doc: (_db, ...segments) => ({ path: pathOf(segments) }),
  query: (coll) => coll,
  limit: (n) => ({ __limit: n }),
  serverTimestamp: () => '__ts__',

  getDocs: async (coll) => {
    const ids = [...(store[coll.__collection] ?? [])].slice(0, 300)
    log.push(`read ${coll.__collection} (${ids.length})`)
    return {
      empty: ids.length === 0,
      size: ids.length,
      docs: ids.map((id) => ({ id, ref: { path: `${coll.__collection}/${id}` } })),
    }
  },

  getDoc: async (ref) => {
    log.push(`get ${ref.path}`)
    const id = ref.path.split('/')[1]
    const data = phoneIndex[id] ?? null
    return { exists: () => data !== null, data: () => data }
  },

  setDoc: async (ref, data) => {
    log.push(`setDoc ${ref.path}`)
    store.__written = { ...(store.__written ?? {}), [ref.path]: data }
  },

  updateDoc: async (ref, data) => {
    log.push(`updateDoc ${ref.path}`)
    store.__updated = { ...(store.__updated ?? {}), [ref.path]: data }
  },

  writeBatch: () => {
    const pending = []
    return {
      delete: (ref) => pending.push(ref.path),
      commit: async () => {
        for (const path of pending) {
          log.push(`delete ${path}`)
          const cut = path.lastIndexOf('/')
          const [coll, id] = [path.slice(0, cut), path.slice(cut + 1)]
          store[coll]?.delete(id)
          if (coll === 'leadPhoneIndex') phoneIndex[id] = null
        }
      },
    }
  },

  // Unused by deleteLead, but imported by the module under test.
  increment: (n) => ({ __increment: n }),
  runTransaction: async () => {},
  arrayUnion: (...v) => ({ __arrayUnion: v }),
}))

const { deleteLead, DeleteNotPermittedError, LEAD_SUBCOLLECTIONS } = await import(
  '../../src/services/leads.service.js'
)

/* ------------------------------------------------------------------ fixtures */

const ADMIN = { uid: 'u-admin', role: 'admin', orgId: 'haflaway', displayName: 'Admin' }

const LEAD = {
  id: 'l1',
  orgId: 'haflaway',
  ownerId: 'u-agent',
  displayName: 'Amina',
  primaryPhoneNormalized: '+255712345678',
  stage: 'won',
  leadStatus: 'won',
  dealValueMinor: 450000,
  attribution: { model: 'first_touch', source: 'whatsapp', campaignId: 'c1' },
}

/** Seed a subcollection with `n` documents. */
function seed(name, n) {
  store[`leads/l1/${name}`] = new Set(Array.from({ length: n }, (_, i) => `${name}${i}`))
}

beforeEach(() => {
  store = {}
  log = []
  phoneIndex = { 'haflaway_+255712345678': { leadId: 'l1', ownerId: 'u-agent' } }
})

/* --------------------------------------------------------------------- gates */

describe('who may delete', () => {
  it('refuses a manager — this is admin-only, and irreversible', async () => {
    await expect(
      deleteLead({ lead: LEAD, user: { ...ADMIN, role: 'manager' }, reason: 'x' }),
    ).rejects.toThrow(DeleteNotPermittedError)
    expect(log).toEqual([])
  })

  it('refuses a lead belonging to another organisation', async () => {
    await expect(
      deleteLead({ lead: { ...LEAD, orgId: 'other' }, user: ADMIN, reason: 'x' }),
    ).rejects.toThrow(/another organisation/)
    expect(log).toEqual([])
  })

  it('refuses without a reason — the tombstone must be able to explain itself', async () => {
    await expect(deleteLead({ lead: LEAD, user: ADMIN, reason: '   ' })).rejects.toThrow(
      /reason is required/,
    )
    expect(log, 'nothing may be touched before the gates pass').toEqual([])
  })
})

/* ------------------------------------------------------------------- cascade */

describe('the cascade', () => {
  it('empties every subcollection and removes the lead last', async () => {
    seed('activities', 3)
    seed('contacts', 1)
    seed('quotes', 2)

    const report = await deleteLead({ lead: LEAD, user: ADMIN, reason: 'duplicate' })

    // The lead document is the FINAL delete. While it exists, a failed run is recoverable;
    // once it is gone, the rules refuse every remaining child forever.
    const deletes = log.filter((l) => l.startsWith('delete '))
    expect(deletes.at(-1)).toBe('delete leads/l1')

    for (const name of LEAD_SUBCOLLECTIONS) {
      expect(store[`leads/l1/${name}`]?.size ?? 0, `${name} not emptied`).toBe(0)
    }
    expect(report.removed).toEqual({ activities: 3, contacts: 1, quotes: 2 })
  })

  it('walks a subcollection longer than one batch', async () => {
    // 300 is the page size; 700 forces three passes and proves the loop re-reads rather
    // than paginating with a cursor into documents it has already destroyed.
    seed('activities', 700)

    const report = await deleteLead({ lead: LEAD, user: ADMIN, reason: 'bulk' })

    expect(report.removed.activities).toBe(700)
    expect(store['leads/l1/activities'].size).toBe(0)
    expect(log.filter((l) => l.startsWith('read leads/l1/activities')).length).toBe(3)
  })

  it('deletes nothing from a lead that has no subcollections', async () => {
    const report = await deleteLead({ lead: LEAD, user: ADMIN, reason: 'empty' })
    expect(report.removed).toEqual({ activities: 0, contacts: 0, quotes: 0 })
    expect(log).toContain('delete leads/l1')
  })
})

/* --------------------------------------------------------------- phone index */

describe('the duplicate lock', () => {
  it('releases the number so the customer can be added again', async () => {
    const report = await deleteLead({ lead: LEAD, user: ADMIN, reason: 'test lead' })

    expect(report.phoneReleased).toBe(true)
    expect(log).toContain('delete leadPhoneIndex/haflaway_+255712345678')
  })

  it('leaves the lock alone when it belongs to a DIFFERENT lead', async () => {
    // The index is keyed by phone, not by lead. After a reassignment or an offline
    // duplicate race it can name another live lead — deleting it blind would strip that
    // lead of its lock and let the same customer be captured twice.
    phoneIndex['haflaway_+255712345678'] = { leadId: 'l2', ownerId: 'u-other' }

    const report = await deleteLead({ lead: LEAD, user: ADMIN, reason: 'duplicate' })

    expect(report.phoneReleased).toBe(false)
    expect(log).not.toContain('delete leadPhoneIndex/haflaway_+255712345678')
    expect(phoneIndex['haflaway_+255712345678']).toEqual({ leadId: 'l2', ownerId: 'u-other' })
  })

  it('copes with a lead that never claimed a number', async () => {
    const report = await deleteLead({
      lead: { ...LEAD, primaryPhoneNormalized: null },
      user: ADMIN,
      reason: 'no phone',
    })
    expect(report.phoneReleased).toBe(false)
    expect(log.some((l) => l.includes('leadPhoneIndex'))).toBe(false)
  })
})

/* ----------------------------------------------------------------- tombstone */

describe('the tombstone', () => {
  it('is written before anything is destroyed', async () => {
    seed('activities', 2)
    await deleteLead({ lead: LEAD, user: ADMIN, reason: 'duplicate' })

    const firstDelete = log.findIndex((l) => l.startsWith('delete '))
    const tombstone = log.indexOf('setDoc leadDeletions/l1')
    expect(tombstone).toBeGreaterThanOrEqual(0)
    expect(tombstone, 'audit record must survive a half-failed run').toBeLessThan(firstDelete)
  })

  it('records who, why, and the attribution needed to explain a moved CAC', async () => {
    await deleteLead({ lead: LEAD, user: ADMIN, reason: 'customer asked' })

    const written = store.__written['leadDeletions/l1']
    expect(written.leadId).toBe('l1')
    expect(written.deletedBy).toBe('u-admin')
    expect(written.reason).toBe('customer asked')
    expect(written.attribution).toEqual(LEAD.attribution)
    expect(written.stage).toBe('won')
  })

  it('keeps NO customer PII — otherwise the delete did not delete', async () => {
    await deleteLead({ lead: LEAD, user: ADMIN, reason: 'erasure request' })

    const serialised = JSON.stringify(store.__written['leadDeletions/l1'])
    expect(serialised).not.toContain('Amina')
    expect(serialised).not.toContain('+255712345678')
  })

  it('is completed with the counts once the cascade has finished', async () => {
    seed('activities', 4)
    await deleteLead({ lead: LEAD, user: ADMIN, reason: 'duplicate' })

    const done = store.__updated['leadDeletions/l1']
    expect(done.removed).toEqual({ activities: 4, contacts: 0, quotes: 0 })
    expect(done.phoneReleased).toBe(true)
    expect(log.indexOf('updateDoc leadDeletions/l1')).toBeGreaterThan(
      log.indexOf('delete leads/l1'),
    )
  })
})

/* ------------------------------------------------------------------ progress */

describe('progress reporting', () => {
  it('names each step so the dialog can say what it is doing', async () => {
    const steps = []
    await deleteLead({
      lead: LEAD,
      user: ADMIN,
      reason: 'duplicate',
      onProgress: ({ step }) => steps.push(step),
    })
    expect(steps).toEqual([...LEAD_SUBCOLLECTIONS, 'phoneIndex', 'lead'])
  })
})
