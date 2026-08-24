/**
 * Shared harness for the security-rules test suite.
 *
 * These tests run against the Firestore emulator, which must already be up:
 *   npm run test:rules
 * (that script wraps vitest in `firebase emulators:exec`).
 *
 * TODO.md P10: rules are production code. Every `allow` in firestore.rules should have
 * both a positive and a negative test here.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'

export const ORG = 'haflaway'
export const OTHER_ORG = 'someone-else'

let testEnv

export async function getTestEnv() {
  if (!testEnv) {
    testEnv = await initializeTestEnvironment({
      projectId: 'haflawaycrm-rules-test',
      firestore: {
        rules: readFileSync(fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    })
  }
  return testEnv
}

export async function teardown() {
  if (testEnv) {
    await testEnv.cleanup()
    testEnv = null
  }
}

export async function clearData() {
  const env = await getTestEnv()
  await env.clearFirestore()
}

/** A signed-in staff member with the given claims. */
export async function as(uid, claims = {}) {
  const env = await getTestEnv()
  return env
    .authenticatedContext(uid, { orgId: ORG, active: true, teamId: 'team-a', ...claims })
    .firestore()
}

export const asAgent = (uid = 'agent1', extra = {}) => as(uid, { role: 'agent', ...extra })
export const asManager = (uid = 'manager1', extra = {}) => as(uid, { role: 'manager', ...extra })
export const asFinance = (uid = 'finance1', extra = {}) => as(uid, { role: 'finance', ...extra })
export const asAdmin = (uid = 'admin1', extra = {}) => as(uid, { role: 'admin', ...extra })
export const asViewer = (uid = 'viewer1', extra = {}) => as(uid, { role: 'viewer', ...extra })

/** Signed in, but deactivated — the claim that revokes access (§7.2). */
export const asDeactivated = (uid = 'ex-staff') => as(uid, { role: 'agent', active: false })

/** Signed in with no role claim at all — an invited user before syncClaims has run. */
export const asClaimless = (uid = 'nobody') => as(uid, { role: undefined, active: undefined })

export async function asAnonymous() {
  const env = await getTestEnv()
  return env.unauthenticatedContext().firestore()
}

/** Seed a document bypassing rules, for arranging test state. */
export async function seed(path, data) {
  const env = await getTestEnv()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore')
    await setDoc(doc(ctx.firestore(), path), data)
  })
}

const NOW = new Date('2026-08-24T09:00:00Z')

/** A lead as it exists in the database, ready to be read or updated. */
export function leadDoc(overrides = {}) {
  return {
    orgId: ORG,
    ownerId: 'agent1',
    teamId: 'team-a',
    displayName: 'Neema & Baraka — Harusi',
    primaryPhoneNormalized: '+255712345678',
    stage: 'new',
    leadStatus: 'open',
    eventType: 'harusi',
    dealValueMinor: null,
    attribution: {
      model: 'first_touch',
      source: 'instagram',
      channel: 'instagram',
      campaignId: 'camp1',
      capturedByUserId: 'agent1',
    },
    createdAt: NOW,
    createdBy: 'agent1',
    updatedAt: NOW,
    updatedBy: 'agent1',
    deletedAt: null,
    ...overrides,
  }
}

export { assertFails, assertSucceeds }
