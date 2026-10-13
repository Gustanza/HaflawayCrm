// One-way import from the old Haflaway CRM app into HaflaCREM (browser side).
//
// SAFETY: this module only READS the old app's collections (leads + their deals/activities/payments
// subcollections, usersPublic/users for names). Every write goes to HaflaCREM's own `crm_*`
// collections (enforced in runImport). The old app's data is never modified or deleted.
// The mapping itself lives in haflawayMap.js.

import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore'
import { auth, db } from '../../fireCreds.js'
import { PREFIX } from '../store.js'
import { pool } from './haflawayMap.js'
export { buildPlan, backupJson } from './haflawayMap.js'

// ---------------------------------------------------------------- 1. read (no writes)
export async function readOldData(onProgress = () => {}) {
  onProgress('Reading leads...')
  let leadSnap
  try {
    leadSnap = await getDocs(collection(db, 'leads'))
  } catch (e) {
    if (e.code !== 'permission-denied') throw e
    // Production rules for the old app only allow org-scoped queries.
    const claims = (await auth.currentUser.getIdTokenResult()).claims
    if (!claims.orgId) throw new Error('Your account cannot read the old Haflaway CRM leads. Sign in with your Haflaway CRM admin account.')
    leadSnap = await getDocs(query(collection(db, 'leads'), where('orgId', '==', claims.orgId)))
  }
  const all = leadSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const oldLeads = all.filter((l) => l.orgId)
  // Records HaflaCREM itself saved here before it moved to crm_* collections.
  const preMoveLeads = all.filter((l) => !l.orgId && (l.lastName || l.ownerName))
  const unknownLeads = all.filter((l) => !l.orgId && !l.lastName && !l.ownerName)

  const subs = await pool(oldLeads, 8, async (l, n) => {
    if (n % 10 === 0) onProgress(`Reading deals, activities and payments... ${n}/${oldLeads.length}`)
    const [deals, activities, payments] = await Promise.all(['deals', 'activities', 'payments'].map(async (name) => {
      const s = await getDocs(collection(db, 'leads', l.id, name))
      return s.docs.map((d) => ({ id: d.id, ...d.data() }))
    }))
    return { deals, activities, payments }
  })
  const leads = oldLeads.map((l, n) => ({ ...l, ...subs[n] }))

  onProgress('Reading team member names...')
  const uids = new Set()
  for (const l of leads) {
    if (l.ownerId) uids.add(l.ownerId)
    for (const a of [...l.activities, ...l.payments]) if (a.byUserId) uids.add(a.byUserId)
  }
  const names = {}
  await pool([...uids], 8, async (uid) => {
    for (const c of ['usersPublic', 'users']) {
      try {
        const s = await getDoc(doc(db, c, uid))
        if (s.exists() && (s.data().displayName || s.data().email)) { names[uid] = s.data().displayName || s.data().email; return }
      } catch { /* not readable with these rules; try the next source */ }
    }
  })

  onProgress('Reading HaflaCREM records saved before the move...')
  const preMove = { leads: preMoveLeads }
  for (const c of ['accounts', 'contacts', 'opportunities', 'tasks', 'activities']) {
    try {
      const s = await getDocs(collection(db, c))
      // Top-level `activities` belong to HaflaCREM: the old app keeps activities inside each lead.
      preMove[c] = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.orgId)
    } catch { preMove[c] = [] }
  }

  return { leads, names, preMove, unknownLeads, readAt: new Date().toISOString() }
}


// ---------------------------------------------------------------- 3. write (crm_* only)
export async function existingIds() {
  const out = {}
  for (const c of ['leads', 'accounts', 'contacts', 'opportunities', 'tasks', 'activities']) {
    const s = await getDocs(collection(db, PREFIX + c))
    out[c] = new Set(s.docs.map((d) => d.id))
  }
  return out
}

export async function runImport(plan, { overwrite = false, onProgress = () => {} } = {}) {
  const have = await existingIds()
  const todo = plan.writes.filter((w) => overwrite || !have[w.col]?.has(w.id))
  const skipped = plan.writes.length - todo.length
  let done = 0
  for (let i = 0; i < todo.length; i += 400) {
    const batch = writeBatch(db)
    for (const w of todo.slice(i, i + 400)) {
      const path = PREFIX + w.col
      if (!path.startsWith(PREFIX) || !['leads', 'accounts', 'contacts', 'opportunities', 'tasks', 'activities'].includes(w.col)) {
        throw new Error(`Refusing to write outside HaflaCREM collections: ${w.col}`)
      }
      batch.set(doc(db, path, w.id), w.data)
    }
    await batch.commit()
    done = Math.min(todo.length, i + 400)
    onProgress(done, todo.length)
  }
  return { written: todo.length, skipped }
}
