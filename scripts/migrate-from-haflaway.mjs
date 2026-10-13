// Copy Haflaway CRM data into HaflaCREM on the LIVE Firebase project, using the gcloud login on
// this computer (`gcloud auth print-access-token`). Same mapping as the in-app import page.
//
//   node scripts/migrate-from-haflaway.mjs            → dry run: read, back up, report. Writes nothing.
//   node scripts/migrate-from-haflaway.mjs --commit   → also writes the new crm_* documents.
//
// Safety:
//  - The old app's collections are only ever read (GET requests).
//  - Writes go only to crm_* collections, with an "exists: false" precondition, so an existing
//    HaflaCREM document is never overwritten; documents already imported are skipped.
//  - A full JSON backup of the old data is saved to backups/ before anything else happens.
//  - The old data is fingerprinted before and after the commit to prove it did not change.

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildPlan, backupJson } from '../src/migration/haflawayMap.js'

const PROJECT = 'haflawaycrm'
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
const PREFIX = 'crm_'
const CRM = ['leads', 'accounts', 'contacts', 'opportunities', 'tasks', 'activities']
const COMMIT = process.argv.includes('--commit')

let token = ''
function refreshToken() {
  token = execSync('gcloud auth print-access-token', { encoding: 'utf8', shell: true }).trim()
}

async function api(path, init = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(path.startsWith('http') ? path : BASE + path, {
      ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    if (res.status === 401 && attempt === 0) { refreshToken(); continue }
    if (res.status === 404) return null
    if (res.status >= 500 || res.status === 429) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue }
    const body = await res.json()
    if (!res.ok) throw new Error(`${res.status} ${body.error?.message || JSON.stringify(body)}`)
    return body
  }
  throw new Error(`Request kept failing: ${path}`)
}

// ---- Firestore REST value <-> JS
function fromValue(v) {
  if ('nullValue' in v) return null
  if ('booleanValue' in v) return v.booleanValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('stringValue' in v) return v.stringValue
  if ('timestampValue' in v) return new Date(v.timestampValue)
  if ('referenceValue' in v) return v.referenceValue
  if ('geoPointValue' in v) return v.geoPointValue
  if ('bytesValue' in v) return v.bytesValue
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue)
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {})
  return null
}
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]))
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  return { mapValue: { fields: toFields(v) } }
}
const toFields = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]))

async function listAll(path) {
  const out = []
  let pageToken = ''
  do {
    const body = await api(`${path}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
    for (const d of body?.documents || []) out.push({ id: d.name.split('/').pop(), _updateTime: d.updateTime, ...fromFields(d.fields || {}) })
    pageToken = body?.nextPageToken || ''
  } while (pageToken)
  return out
}

async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n], n) }
  }))
  return out
}

// Fingerprint of everything the old app owns that we read: document names + server update times.
async function fingerprint(leads) {
  const h = createHash('sha256')
  const fresh = await listAll('/leads')
  for (const l of fresh.sort((a, b) => a.id.localeCompare(b.id))) {
    h.update(l.id + l._updateTime)
    if (!l.orgId) continue
    for (const sub of ['deals', 'activities', 'payments']) {
      for (const d of (await listAll(`/leads/${l.id}/${sub}`)).sort((a, b) => a.id.localeCompare(b.id))) h.update(d.id + d._updateTime)
    }
  }
  return { hash: h.digest('hex').slice(0, 16), leads: fresh.length }
}

const strip = (r) => { const { _updateTime, ...rest } = r; return rest }

async function main() {
  refreshToken()
  console.log(`Project: ${PROJECT} · Mode: ${COMMIT ? 'COMMIT (will write crm_* documents)' : 'DRY RUN (no writes)'}`)

  console.log('Reading old leads...')
  const all = (await listAll('/leads')).map(strip)
  const oldLeads = all.filter((l) => l.orgId)
  const preMoveLeads = all.filter((l) => !l.orgId && (l.lastName || l.ownerName))
  const unknownLeads = all.filter((l) => !l.orgId && !l.lastName && !l.ownerName)
  console.log(`  ${all.length} documents in "leads": ${oldLeads.length} Haflaway CRM leads, ${preMoveLeads.length} HaflaCREM (pre-move), ${unknownLeads.length} other`)

  console.log('Reading deals, activities and payments...')
  const subs = await pool(oldLeads, 8, async (l) => {
    const [deals, activities, payments] = await Promise.all(['deals', 'activities', 'payments'].map(async (s) => (await listAll(`/leads/${l.id}/${s}`)).map(strip)))
    return { deals, activities, payments }
  })
  const leads = oldLeads.map((l, n) => ({ ...l, ...subs[n] }))

  console.log('Reading team member names...')
  const uids = new Set()
  for (const l of leads) {
    if (l.ownerId) uids.add(l.ownerId)
    for (const a of [...l.activities, ...l.payments]) if (a.byUserId) uids.add(a.byUserId)
  }
  const names = {}
  await pool([...uids], 8, async (uid) => {
    for (const c of ['usersPublic', 'users']) {
      const d = await api(`/${c}/${uid}`)
      const f = d ? fromFields(d.fields || {}) : null
      if (f?.displayName || f?.email) { names[uid] = f.displayName || f.email; return }
    }
  })

  const preMove = { leads: preMoveLeads }
  for (const c of ['accounts', 'contacts', 'opportunities', 'tasks', 'activities']) {
    preMove[c] = (await listAll(`/${c}`)).map(strip).filter((r) => !r.orgId)
  }
  const data = { leads, names, preMove, unknownLeads, readAt: new Date().toISOString() }

  mkdirSync('backups', { recursive: true })
  const file = `backups/haflaway-crm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, backupJson(data))
  console.log(`Backup saved: ${file}`)

  const plan = buildPlan(data)
  console.log('Found:', JSON.stringify({ leads: plan.stats.leads, deals: plan.stats.deals, activities: plan.stats.activities, payments: plan.stats.payments, deletedSkipped: plan.stats.skippedDeleted, voidedActivities: plan.stats.voidedActivities, voidedPayments: plan.stats.voidedPayments }))

  const existing = {}
  for (const c of CRM) existing[c] = new Set((await listAll(`/${PREFIX}${c}`)).map((d) => d.id))
  const todo = plan.writes.filter((w) => !existing[w.col]?.has(w.id))
  const byCol = {}
  for (const w of plan.writes) byCol[w.col] = byCol[w.col] || { total: 0, toAdd: 0 }, byCol[w.col].total++
  for (const w of todo) byCol[w.col].toAdd++
  console.log('Plan (crm_* collection: total / to add now):')
  for (const c of CRM) if (byCol[c]) console.log(`  crm_${c}: ${byCol[c].total} / ${byCol[c].toAdd}`)
  const status = {}
  for (const p of plan.preview) status[`${p.oldStatus} → ${p.newStatus}`] = (status[`${p.oldStatus} → ${p.newStatus}`] || 0) + 1
  console.log('Lead status mapping:', JSON.stringify(status))
  if (plan.warnings.length) console.log(`Warnings (${plan.warnings.length}):\n  - ` + plan.warnings.slice(0, 40).join('\n  - '))

  if (!COMMIT) { console.log('\nDry run finished. Nothing was written.'); return }

  const before = await fingerprint()
  console.log('Old data fingerprint before:', before)
  let written = 0
  for (let i = 0; i < todo.length; i += 400) {
    const writes = todo.slice(i, i + 400).map((w) => {
      if (!CRM.includes(w.col)) throw new Error(`Refusing to write outside crm_*: ${w.col}`)
      return {
        update: { name: `projects/${PROJECT}/databases/(default)/documents/${PREFIX}${w.col}/${w.id}`, fields: toFields(w.data) },
        currentDocument: { exists: false },
      }
    })
    await api(':commit', { method: 'POST', body: JSON.stringify({ writes }) })
    written += writes.length
    console.log(`  wrote ${written}/${todo.length}`)
  }
  const after = await fingerprint()
  console.log('Old data fingerprint after: ', after, before.hash === after.hash ? 'UNCHANGED ✔' : 'CHANGED ✘ (investigate)')
  for (const c of CRM) console.log(`  crm_${c} now: ${(await listAll(`/${PREFIX}${c}`)).length}`)
  console.log(`\nDone: ${written} documents written, ${plan.writes.length - todo.length} already existed.`)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
