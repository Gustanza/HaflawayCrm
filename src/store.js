import { reactive } from 'vue'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth'
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, writeBatch, query, where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../fireCreds.js'
import { OBJECTS, stageProbability, recordName, WON_STAGE } from './meta/objects.js'
import { todayISO, addDaysISO } from './format.js'

const num = (v) => Number(v) || 0

const COLLECTIONS = [...Object.keys(OBJECTS), 'activities']

// HaflaCREM keeps its data in its own `crm_*` collections. The Firebase project is shared with the
// older Haflaway CRM app (which owns `leads`, `users`, `orgs`, ...), so the two must never overlap.
export const PREFIX = 'crm_'
export const col = (name) => collection(db, PREFIX + name)
export const docRef = (name, id) => doc(db, PREFIX + name, id)

// Always an admin; must match functions/users.js and firestore.rules.
export const SUPER_ADMIN_EMAIL = 'haflaway@gmail.com'
export const ROLES = { admin: 'Admin', rep: 'Sales Rep' }

export const store = reactive({
  user: null, // { uid, email, name, role }; role is undefined while loading, null without access, else 'admin' | 'rep'
  users: [], // team profiles (crm_users)
  authReady: false,
  loaded: false,
  error: null,
  toasts: [],
  sms: [], // open SMS drafts (pending, sending, scheduled, failed): a rep's own, or the whole team's for an admin
  ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
})

/* ---------------- Auth ---------------- */

let unsubscribers = []
let unsubscribeProfile = null
let resolveAuthReady
export const authReady = new Promise((r) => (resolveAuthReady = r))
const roleWaiters = []

export const isSuperAdminEmail = (email) => String(email || '').toLowerCase() === SUPER_ADMIN_EMAIL
export const isAdmin = () => store.user?.role === 'admin'
// Role of a crm_users profile, the same way the Firestore rules decide it.
export const roleOfProfile = (p) => (isSuperAdminEmail(p?.email) ? 'admin' : p?.active === true && ROLES[p.role] ? p.role : null)

onAuthStateChanged(auth, (u) => {
  unsubscribeAll()
  unsubscribeProfile?.()
  unsubscribeProfile = null
  store.user = u ? { uid: u.uid, email: u.email, name: u.displayName || u.email.split('@')[0], role: undefined } : null
  store.authReady = true
  resolveAuthReady()
  if (u) watchProfile(u)
  else releaseRoleWaiters()
})

// Resolves once the signed-in user's role is known (straight away when nobody is signed in).
export function roleReady() {
  return !store.user || store.user.role !== undefined ? Promise.resolve() : new Promise((r) => roleWaiters.push(r))
}
function releaseRoleWaiters() {
  roleWaiters.splice(0).forEach((r) => r())
}

// The profile decides what this person may see, and an admin can change it at any time, so watch it live.
function watchProfile(u) {
  const superAdmin = isSuperAdminEmail(u.email)
  unsubscribeProfile = onSnapshot(
    docRef('users', u.uid),
    (snap) => {
      if (superAdmin && !snap.exists()) {
        setDoc(docRef('users', u.uid), { name: store.user.name, email: u.email, createdAt: Date.now() })
          .catch((err) => console.warn('[HaflaCREM] could not create the super admin profile:', err.message))
      }
      const role = roleOfProfile({ ...snap.data(), email: u.email })
      const changed = role !== store.user.role
      store.user = { ...store.user, role }
      if (changed) {
        if (role) subscribeAll()
        else {
          unsubscribeAll()
          store.loaded = true
        }
      }
      releaseRoleWaiters()
    },
    (err) => {
      console.error('[HaflaCREM] profile:', err)
      store.user = { ...store.user, role: null }
      store.loaded = true
      releaseRoleWaiters()
    },
  )
}

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

// Rename the signed-in user everywhere it shows: their profile, the owner name on records they own (stored on each
// record), and the name SMS use ("<owner> atakupigia…") from now on.
export async function updateMyName(name) {
  const u = auth.currentUser
  await updateProfile(u, { displayName: name })
  await u.getIdToken(true) // SMS functions read the name from the sign-in token
  store.user = { ...store.user, name }
  await setDoc(docRef('users', u.uid), { name }, { merge: true })
  const mine = [...Object.keys(OBJECTS), 'activities'].flatMap((c) =>
    store[c].filter((r) => r.ownerId === u.uid && r.ownerName !== name).map((r) => docRef(c, r.id)))
  for (let i = 0; i < mine.length; i += 450) {
    const batch = writeBatch(db)
    mine.slice(i, i + 450).forEach((ref) => batch.update(ref, { ownerName: name }))
    await batch.commit()
  }
  return mine.length
}

export function logout() {
  return signOut(auth)
}

/* ---------------- Realtime data ---------------- */

// Admins load every record; reps only the records they own (the Firestore rules refuse anything else).
function subscribeAll() {
  unsubscribeAll()
  const scoped = (name) => (isAdmin() ? col(name) : query(col(name), where('ownerId', '==', store.user.uid)))
  let pending = COLLECTIONS.length
  unsubscribers = COLLECTIONS.map((name) =>
    onSnapshot(
      scoped(name),
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
  unsubscribers.push(subscribeSms(), subscribeUsers())
}

function subscribeUsers() {
  return onSnapshot(
    col('users'),
    (snap) => (store.users = snap.docs
      // Older profiles may lack an email; your own comes from your sign-in (that's how the super admin is recognised).
      .map((d) => ({ id: d.id, ...d.data(), email: d.get('email') || (d.id === store.user.uid ? store.user.email : '') }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))),
    (err) => console.warn('[HaflaCREM] team list unavailable:', err.message),
  )
}

// SMS drafts are created by Cloud Functions. Reps see (and approve) their own; admins see the whole team's.
function subscribeSms() {
  const open = where('status', 'in', ['pending', 'sending', 'scheduled', 'failed'])
  const q = isAdmin() ? query(col('sms'), open) : query(col('sms'), where('ownerId', '==', store.user.uid), open)
  return onSnapshot(
    q,
    (snap) => (store.sms = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt)),
    (err) => {
      console.warn('[HaflaCREM] SMS drafts unavailable:', err.message)
      store.sms = []
    },
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
  store.sms = []
  store.users = []
  store.loaded = false
  store.error = null
}

export function getRecord(objectKey, id) {
  return id ? store[objectKey]?.find((r) => r.id === id) : undefined
}

export function nameOf(objectKey, id) {
  return recordName(objectKey, getRecord(objectKey, id))
}

/* ---------------- Team ---------------- */

// People who can own records: everyone with active access.
export function teamMembers() {
  return store.users.filter((u) => roleOfProfile(u))
}

export function userName(uid) {
  if (uid === store.user?.uid) return store.user.name
  return store.users.find((u) => u.id === uid)?.name || ''
}

const call = (name) => (data) => httpsCallable(functions, name)(data).then((r) => r.data)
export const adminCreateUser = call('adminCreateUser') // { name, email, password, role }
export const adminUpdateUser = call('adminUpdateUser') // { uid, role?, active? }
export const adminSetPassword = call('adminSetPassword') // { uid, password }
export const adminReassign = call('adminReassign') // { fromUid, toUid } | { object, id, toUid }

/* ---------------- CRUD ---------------- */

function me() {
  return { ownerId: store.user.uid, ownerName: store.user.name }
}

// Who a new record belongs to. Reps always own what they create. An admin can choose; by default a record
// added under someone's lead, account or contact goes to that person, so it stays in their book.
export function defaultOwnerId(data) {
  if (!isAdmin()) return store.user.uid
  const parent = (data.relatedType && getRecord(data.relatedType, data.relatedId))
    || getRecord('accounts', data.accountId) || getRecord('contacts', data.contactId)
  return parent?.ownerId || store.user.uid
}

function ownerFor(data) {
  if (!isAdmin()) return me()
  const ownerId = data.ownerId || defaultOwnerId(data)
  return { ownerId, ownerName: userName(ownerId) }
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
  const record = { ...clean(data), ...ownerFor(data), createdAt: now, updatedAt: now }
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

// An activity belongs to the record's owner, so it stays visible to them; byId/byName say who did it.
export function logActivity({ type, subject, body = '', relatedType, relatedId }) {
  const rec = getRecord(relatedType, relatedId)
  return addDoc(col('activities'), {
    type, subject, body, relatedType, relatedId,
    accountId: accountOf(relatedType, relatedId),
    ...(rec?.ownerId ? { ownerId: rec.ownerId, ownerName: rec.ownerName || '' } : me()),
    byId: store.user.uid, byName: store.user.name,
    createdAt: Date.now(),
  })
}

/* ---------------- Lead conversion ---------------- */

export async function convertLead(lead, { accountId, accountName, createOpportunity, opportunityName, service }) {
  const batch = writeBatch(db)
  const now = Date.now()
  // Everything made from a lead stays with the lead's owner, even when an admin converts it.
  const owner = lead.ownerId ? { ownerId: lead.ownerId, ownerName: lead.ownerName || '' } : me()
  const base = { ...owner, createdAt: now, updatedAt: now }

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
    relatedType: 'contacts', relatedId: conRef.id, accountId, ...owner, byId: store.user.uid, byName: store.user.name, createdAt: now,
  })

  await batch.commit()
  return { accountId, contactId: conRef.id, opportunityId }
}

/* ---------------- SMS ---------------- */

// when: undefined (send now, refused during quiet hours) | 'now' (send anyway) | 'schedule' (next 08:00)
export async function sendSms(id, { content, phone, when }) {
  const res = await httpsCallable(functions, 'smsSend')({ id, content, phone, when })
  return res.data
}

export function cancelSms(id) {
  return httpsCallable(functions, 'smsCancel')({ id })
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
