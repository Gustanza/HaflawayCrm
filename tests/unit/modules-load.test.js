/**
 * A compile check is not enough — Vite only bundles what's actually imported from a route,
 * so a syntax/export error in a not-yet-wired service or store would sit invisible until
 * Phase 3/4 wires it up. This just imports every module that talks to Firestore and asserts
 * the expected exports exist, without ever calling getDb() (nothing here does that at module
 * scope) or touching a real/emulated backend.
 */
import { describe, it, expect } from 'vitest'

describe('service modules load and export what callers expect', () => {
  it('leads.service.js', async () => {
    const m = await import('../../src/services/leads.service.js')
    expect(typeof m.createLead).toBe('function')
    expect(typeof m.updateLead).toBe('function')
    expect(typeof m.reassignLead).toBe('function')
    expect(typeof m.deleteLead).toBe('function')
    expect(typeof m.checkPhoneAvailable).toBe('function')
    expect(Array.isArray(m.LEAD_SUBCOLLECTIONS)).toBe(true)
  })

  it('deals.service.js', async () => {
    const m = await import('../../src/services/deals.service.js')
    expect(typeof m.addDeal).toBe('function')
    expect(typeof m.closeDeal).toBe('function')
    expect(typeof m.reopenDeal).toBe('function')
  })

  it('activities.service.js', async () => {
    const m = await import('../../src/services/activities.service.js')
    expect(typeof m.logActivity).toBe('function')
    expect(typeof m.voidActivity).toBe('function')
    expect(typeof m.setNextFollowUp).toBe('function')
  })

  it('queries.js', async () => {
    const m = await import('../../src/services/queries.js')
    for (const fn of [
      'workQueueQuery', 'leadListQuery', 'upcomingEventsQuery', 'hotLeadsQuery',
      'leadsCreatedInPeriodQuery', 'dealsClosedInPeriodQuery', 'leadDealsQuery',
      'activitiesInPeriodQuery', 'leadTimelineQuery',
    ]) {
      expect(typeof m[fn], `${fn} should be a function`).toBe('function')
    }
  })
})

describe('queries.js throws a clear error rather than a silent bad query', () => {
  it('rejects a caller with no orgId', async () => {
    const { workQueueQuery } = await import('../../src/services/queries.js')
    await expect(workQueueQuery({})).rejects.toThrow(/orgId/)
  })

  it('rejects an unknown role', async () => {
    const { workQueueQuery } = await import('../../src/services/queries.js')
    await expect(workQueueQuery({ orgId: 'x', role: 'nonsense' })).rejects.toThrow(/may not list/)
  })

  it('rejects a manager with no teamId claim', async () => {
    const { workQueueQuery } = await import('../../src/services/queries.js')
    await expect(workQueueQuery({ orgId: 'x', role: 'manager' })).rejects.toThrow(/teamId/)
  })
})
