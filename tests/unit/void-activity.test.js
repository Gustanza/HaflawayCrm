/**
 * Retracting a timeline entry.
 *
 * The record is append-only (P1, P4) - it is what settles a commission dispute months
 * later, so an entry logged by mistake is struck through with a stated reason rather than
 * edited away. What these cover is the part that is easy to get subtly wrong: the lead
 * carries a denormalised copy of the newest entry (`lastNote`, rendered in every list), and
 * retracting an entry must retract that copy too - but ONLY when the copy came from the
 * entry being retracted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let lead
let log

vi.mock('@/firebase/app.js', () => ({ getDb: async () => ({ fake: true }) }))

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...segments) => ({ __collection: segments.join('/') }),
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  query: (coll) => coll,
  limit: (n) => ({ __limit: n }),
  serverTimestamp: () => '__ts__',
  getDocs: async () => ({ empty: true, size: 0, docs: [] }),
  getDoc: async (ref) => ({ exists: () => ref.path === 'leads/l1', data: () => lead }),
  setDoc: async () => {},
  updateDoc: async (ref, data) => log.push({ path: ref.path, data }),
  writeBatch: () => {
    const pending = []
    return {
      update: (ref, data) => pending.push({ path: ref.path, data }),
      delete: () => {},
      commit: async () => pending.forEach((op) => log.push(op)),
    }
  },
  increment: (n) => ({ __increment: n }),
  runTransaction: async () => {},
  arrayUnion: (...v) => ({ __arrayUnion: v }),
}))

const { voidActivity } = await import('../../src/services/leads.service.js')

const USER = { uid: 'u-agent', displayName: 'Agent' }
const opOn = (path) => log.find((o) => o.path === path)

beforeEach(() => {
  log = []
  lead = { lastActivityId: 'a9', lastOutcome: 'spoke', lastNote: 'Wants the quote Friday' }
})

describe('voidActivity', () => {
  it('demands a reason - a retraction nobody explained is not a correction', async () => {
    await expect(
      voidActivity({ leadId: 'l1', activityId: 'a9', user: USER, reason: '  ' }),
    ).rejects.toThrow(/reason/i)
    expect(log).toEqual([])
  })

  it('marks the entry voided with who, why and when', async () => {
    await voidActivity({ leadId: 'l1', activityId: 'a9', user: USER, reason: 'wrong lead' })

    const op = opOn('leads/l1/activities/a9')
    expect(op.data).toMatchObject({
      isVoided: true,
      voidedBy: 'u-agent',
      voidReason: 'wrong lead',
    })
  })

  it('never deletes the entry - the record keeps the mistake AND the correction', async () => {
    await voidActivity({ leadId: 'l1', activityId: 'a9', user: USER, reason: 'wrong lead' })
    expect(log.every((op) => op.data !== undefined)).toBe(true)
  })

  it('retracts the copy the lists render, when it came from this entry', async () => {
    await voidActivity({ leadId: 'l1', activityId: 'a9', user: USER, reason: 'wrong lead' })

    // Otherwise a note the user has explicitly withdrawn keeps being quoted in the work
    // queue, with the retraction visible only to whoever opens the timeline - the one
    // person who already knows.
    expect(opOn('leads/l1').data).toMatchObject({
      lastOutcome: null,
      lastNote: null,
      lastActivityId: null,
    })
  })

  it('leaves the copy alone when a DIFFERENT, older entry is retracted', async () => {
    await voidActivity({ leadId: 'l1', activityId: 'a3', user: USER, reason: 'mistake' })

    // Blanking here would throw away an accurate summary that a newer, still-valid
    // activity produced.
    expect(opOn('leads/l1')).toBeUndefined()
    expect(opOn('leads/l1/activities/a3')).toBeTruthy()
  })

  it('copes with a lead that has no summary yet', async () => {
    lead = { lastActivityId: null }
    await voidActivity({ leadId: 'l1', activityId: 'a9', user: USER, reason: 'mistake' })
    expect(opOn('leads/l1')).toBeUndefined()
  })

  it('trims the reason, so whitespace cannot pass the rules check', async () => {
    await voidActivity({ leadId: 'l1', activityId: 'a9', user: USER, reason: '  typo  ' })
    expect(opOn('leads/l1/activities/a9').data.voidReason).toBe('typo')
  })
})
