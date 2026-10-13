import { reactive } from 'vue'
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile,
} from 'firebase/auth'
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, writeBatch,
} from 'firebase/firestore'
import { auth, db } from '../fireCreds.js'
import { OBJECTS, stageProbability, recordName, WON_STAGE } from './meta/objects.js'
import { todayISO, addDaysISO } from './format.js'

const num = (v) => Number(v) || 0

const COLLECTIONS = [...Object.keys(OBJECTS), 'activities']

// HaflaCREM keeps its data in its own `crm_*` collections. The Firebase project is shared with the
// older Haflaway CRM app (which owns `leads`, `users`, `orgs`, ...), so the two must never overlap.
export const PREFIX = 'crm_'
export const col = (name) => collection(db, PREFIX + name)
export const docRef = (name, id) => doc(db, PREFIX + name, id)

export const store = reactive({
  user: null,
  authReady: false,
  loaded: false,
  error: null,
  toasts: [],
  ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
})

/* ---------------- Auth ---------------- */

let unsubscribers = []
let resolveAuthReady
export const authReady = new Promise((r) => (resolveAuthReady = r))

onAuthStateChanged(auth, (u) => {
  store.user = u ? { uid: u.uid, email: u.email, name: u.displayName || u.email.split('@')[0] } : null
  store.authReady = true
  resolveAuthReady()
  if (u) subscribeAll()
  else unsubscribeAll()
})

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

export async function signup(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  await updateProfile(cred.user, { displayName: name })
  store.user = { uid: cred.user.uid, email, name }
  await setDoc(docRef('users', cred.user.uid), { name, email, createdAt: Date.now() })
}

export function logout() {
  return signOut(auth)
}

/* ---------------- Realtime data ---------------- */

function subscribeAll() {
  unsubscribeAll()
  let pending = COLLECTIONS.length
  unsubscribers = COLLECTIONS.map((name) =>
    onSnapshot(
      col(name),
      (snap) => {
        store[name] = snap.docs.map((d) => normalize({ id: d.id, ...d.data() }))
        if (pending > 0 && --pending === 0) store.loaded = true
      },
      (err) => {
        console.error(`[HaflaCREM] ${name}:`, err)
        store.error = err.code === 'permission-denied'
          ? 'Firestore denied access. Check your Firestore security rules (see firestore.rules).'
          : err.message
        store.loaded = true
      },
    ),
  )
}

// Records created outside HaflaCREM (Firebase console, other apps) may use Firestore Timestamps
// or lack our timestamp fields; normalize so dates and sorting still work.
function normalize(r) {
  for (const [k, v] of Object.entries(r)) if (v && typeof v.toMillis === 'function') r[k] = v.toMillis()
  if (typeof r.createdAt !== 'number') r.createdAt = typeof r.createdAt === 'string' ? Date.parse(r.createdAt) || 0 : 0
  if (typeof r.updatedAt !== 'number') r.updatedAt = r.createdAt
  return r
}

function unsubscribeAll() {
  unsubscribers.forEach((u) => u())
  unsubscribers = []
  COLLECTIONS.forEach((c) => (store[c] = []))
  store.loaded = false
  store.error = null
}

export function getRecord(objectKey, id) {
  return id ? store[objectKey]?.find((r) => r.id === id) : undefined
}

export function nameOf(objectKey, id) {
  return recordName(objectKey, getRecord(objectKey, id))
}

/* ---------------- CRUD ---------------- */

function owner() {
  return { ownerId: store.user.uid, ownerName: store.user.name }
}

// Account a record rolls up to, so contact/opportunity activity also shows on the account.
function accountOf(type, id) {
  if (type === 'accounts') return id
  return getRecord(type, id)?.accountId || null
}

function clean(data) {
  return Object.fromEntries(Object.entries(data).filter(([k, v]) => k !== 'id' && v !== undefined))
}

export async function createRecord(objectKey, data) {
  const now = Date.now()
  const record = { ...clean(data), ...owner(), createdAt: now, updatedAt: now }
  if (objectKey === 'opportunities') {
    record.probability = stageProbability(record.stage)
    record.balance = num(record.amount) - num(record.amountPaid)
  }
  if (objectKey === 'opportunities' && record.stage === WON_STAGE) record.completedDate = todayISO()
  if (objectKey === 'tasks' && record.relatedType) record.accountId = accountOf(record.relatedType, record.relatedId)
  const ref = await addDoc(col(objectKey), record)
  return ref.id
}

export async function updateRecord(objectKey, id, changes) {
  const before = getRecord(objectKey, id) || {}
  const patch = { ...clean(changes), updatedAt: Date.now() }
  if (objectKey === 'opportunities') {
    if (patch.stage) {
      patch.probability = stageProbability(patch.stage)
      // Record when a job was actually finished; revenue charts use this date.
      if (patch.stage === WON_STAGE && before.stage !== WON_STAGE) patch.completedDate = todayISO()
      if (patch.stage !== WON_STAGE && before.stage === WON_STAGE) patch.completedDate = null
    }
    if ('amount' in patch || 'amountPaid' in patch) {
      patch.balance = num('amount' in patch ? patch.amount : before.amount) - num('amountPaid' in patch ? patch.amountPaid : before.amountPaid)
    }
  }
  if (objectKey === 'tasks' && 'relatedType' in patch) patch.accountId = patch.relatedType ? accountOf(patch.relatedType, patch.relatedId) : null
  await updateDoc(docRef(objectKey, id), patch)

  const pathField = OBJECTS[objectKey].path?.field
  if (pathField && patch[pathField] && patch[pathField] !== before[pathField]) {
    await logActivity({
      type: 'system',
      subject: `${OBJECTS[objectKey].fields.find((f) => f.key === pathField).label} changed from ${before[pathField] || 'blank'} to ${patch[pathField]}`,
      relatedType: objectKey,
      relatedId: id,
    })
  }
}

// Only the fields that differ from `before`, so a save never overwrites changes made elsewhere meanwhile.
// Cleared inputs ('' from v-model) are stored as null.
export function changedFields(before, after, keys) {
  const out = {}
  for (const k of keys) {
    const v = after[k] === '' ? null : after[k]
    const b = before[k] === '' || before[k] === undefined ? null : before[k]
    if (JSON.stringify(v ?? null) !== JSON.stringify(b)) out[k] = v ?? null
  }
  return out
}

export function deleteRecord(objectKey, id) {
  return deleteDoc(docRef(objectKey, id))
}

export function logActivity({ type, subject, body = '', relatedType, relatedId }) {
  return addDoc(col('activities'), {
    type, subject, body, relatedType, relatedId,
    accountId: accountOf(relatedType, relatedId),
    ...owner(),
    createdAt: Date.now(),
  })
}

/* ---------------- Lead conversion ---------------- */

export async function convertLead(lead, { accountId, accountName, createOpportunity, opportunityName, service }) {
  const batch = writeBatch(db)
  const now = Date.now()
  const base = { ...owner(), createdAt: now, updatedAt: now }

  if (!accountId) {
    const accRef = doc(col('accounts'))
    batch.set(accRef, {
      ...base, name: accountName, type: 'Prospect', phone: lead.phone || '', description: lead.description || '',
      eventType: lead.eventType || null, eventDate: lead.eventDate || null,
    })
    accountId = accRef.id
  }

  const conRef = doc(col('contacts'))
  batch.set(conRef, {
    ...base, accountId,
    firstName: lead.firstName || '', lastName: lead.lastName || recordName('leads', lead), title: lead.title || '',
    email: lead.email || '', phone: lead.phone || '', source: lead.source || '',
  })

  let opportunityId = null
  if (createOpportunity) {
    const oppRef = doc(col('opportunities'))
    // Default delivery date: a week before the event, or two weeks from now.
    const close = /^\d{4}-\d{2}-\d{2}$/.test(lead.eventDate || '') ? addDaysISO(lead.eventDate, -7) : addDaysISO(todayISO(), 14)
    batch.set(oppRef, {
      ...base, accountId, contactId: conRef.id, name: opportunityName, service: service || lead.service || null,
      eventType: lead.eventType || null, eventDate: lead.eventDate || null, guests: lead.guests ?? null,
      stage: 'Inquiry', probability: stageProbability('Inquiry'), closeDate: close,
      amount: null, amountPaid: null, balance: 0, source: lead.source || '',
    })
    opportunityId = oppRef.id
  }

  batch.update(docRef('leads', lead.id), {
    status: 'Converted', convertedAt: now, updatedAt: now,
    convertedAccountId: accountId, convertedContactId: conRef.id, convertedOpportunityId: opportunityId,
  })

  // Move the lead's history (calls, notes, tasks) onto the new contact so it shows on the account too.
  for (const a of store.activities) {
    if (a.relatedType === 'leads' && a.relatedId === lead.id) {
      batch.update(docRef('activities', a.id), { relatedType: 'contacts', relatedId: conRef.id, accountId })
    }
  }
  for (const t of store.tasks) {
    if (t.relatedType === 'leads' && t.relatedId === lead.id) {
      batch.update(docRef('tasks', t.id), { relatedType: 'contacts', relatedId: conRef.id, accountId, updatedAt: now })
    }
  }

  const actRef = doc(col('activities'))
  batch.set(actRef, {
    type: 'system', subject: `Lead converted from ${recordName('leads', lead)}`, body: '',
    relatedType: 'contacts', relatedId: conRef.id, accountId, ...owner(), createdAt: now,
  })

  await batch.commit()
  return { accountId, contactId: conRef.id, opportunityId }
}

/* ---------------- Toasts ---------------- */

let toastId = 0
export function toast(message, variant = 'success') {
  const id = ++toastId
  store.toasts = [{ id, message, variant }] // one at a time, so toasts never stack over the page

  setTimeout(() => dismissToast(id), 4000)
}
export function dismissToast(id) {
  store.toasts = store.toasts.filter((t) => t.id !== id)
}
