// HaflaCREM team management. Only admins add people, change roles, (de)activate accounts and move records
// between owners. Roles live on crm_users/{uid} ({ role: 'admin' | 'rep', active: true }), which the app
// itself can never change (see firestore.rules); SUPER_ADMIN_EMAIL is always an admin and can't be changed.
//
// Reps see and work only the records they own; admins see everything.

import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

// Must match isSuperAdmin() in ../firestore.rules and SUPER_ADMIN_EMAIL in ../src/store.js.
export const SUPER_ADMIN_EMAIL = 'haflaway@gmail.com'
const ROLES = ['admin', 'rep']
const USERS = 'crm_users'
const RECORDS = ['crm_leads', 'crm_accounts', 'crm_contacts', 'crm_opportunities', 'crm_tasks', 'crm_activities']
const OPEN_SMS = ['pending', 'failed', 'scheduled']

// index.js calls initializeApp() after this module loads, so look Firestore up per call.
const db = () => getFirestore()
const isSuperAdmin = (email) => String(email || '').toLowerCase() === SUPER_ADMIN_EMAIL

// 'admin' | 'rep' for someone with active access, otherwise null (pending, deactivated or unknown).
export async function roleOf(auth) {
  if (!auth) return null
  if (isSuperAdmin(auth.token.email)) return 'admin'
  const p = (await db().doc(`${USERS}/${auth.uid}`).get()).data()
  return p?.active === true && ROLES.includes(p.role) ? p.role : null
}

async function requireAdmin(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.')
  if ((await roleOf(req.auth)) !== 'admin') throw new HttpsError('permission-denied', 'Only an admin can do this.')
}

// A user the caller may change: never the super admin, and never themselves (so nobody locks themselves out).
async function changeableUser(req, uid) {
  if (!uid) throw new HttpsError('invalid-argument', 'Missing user.')
  if (uid === req.auth.uid) throw new HttpsError('failed-precondition', "You can't change your own access. Ask another admin.")
  const user = await getAuth().getUser(uid).catch(() => null)
  if (!user) throw new HttpsError('not-found', 'This user no longer exists.')
  if (isSuperAdmin(user.email)) throw new HttpsError('failed-precondition', `${SUPER_ADMIN_EMAIL} is the super admin and can't be changed.`)
  return user
}

function checkPassword(password) {
  if (String(password || '').length < 6) throw new HttpsError('invalid-argument', 'The password must be at least 6 characters.')
}

// data: { name, email, password, role }. If the email already has an account (e.g. from the old Haflaway app),
// that account gets access and keeps its current password.
export const adminCreateUser = onCall(async (req) => {
  await requireAdmin(req)
  const name = String(req.data?.name || '').trim()
  const email = String(req.data?.email || '').trim().toLowerCase()
  const { password, role } = req.data || {}
  if (!name) throw new HttpsError('invalid-argument', "Enter the person's name.")
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email address.')
  if (!ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Choose a role.')
  if (isSuperAdmin(email)) throw new HttpsError('failed-precondition', `${SUPER_ADMIN_EMAIL} is already the super admin.`)
  checkPassword(password)

  let user = await getAuth().getUserByEmail(email).catch(() => null)
  const existing = !!user
  if (existing) await getAuth().updateUser(user.uid, { disabled: false })
  else user = await getAuth().createUser({ email, password, displayName: name })

  await db().doc(`${USERS}/${user.uid}`).set(
    { name: existing ? user.displayName || name : name, email, role, active: true, createdBy: req.auth.uid, createdAt: Date.now() },
    { merge: true },
  )
  return { uid: user.uid, existing }
})

// data: { uid, role?, active? }. Deactivating also signs the person out everywhere.
export const adminUpdateUser = onCall(async (req) => {
  await requireAdmin(req)
  const { uid, role, active } = req.data || {}
  const user = await changeableUser(req, uid)
  const patch = { updatedAt: Date.now(), updatedBy: req.auth.uid }
  if (role !== undefined) {
    if (!ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Choose a role.')
    patch.role = role
  }
  if (active !== undefined) {
    patch.active = active === true
    await getAuth().updateUser(uid, { disabled: !patch.active })
    if (!patch.active) await getAuth().revokeRefreshTokens(uid)
  }
  const ref = db().doc(`${USERS}/${uid}`)
  const snap = await ref.get()
  if (!snap.exists) patch.email = user.email || ''
  if (!snap.exists || !snap.get('name')) patch.name = user.displayName || user.email || ''
  await ref.set(patch, { merge: true })
  return { ok: true }
})

// data: { uid, password }
export const adminSetPassword = onCall(async (req) => {
  await requireAdmin(req)
  const { uid, password } = req.data || {}
  await changeableUser(req, uid)
  checkPassword(password)
  await getAuth().updateUser(uid, { password })
  await getAuth().revokeRefreshTokens(uid)
  return { ok: true }
})

// Move records to another owner, including their open SMS drafts.
//   { fromUid, toUid }      every record owned by fromUid (null = records with no owner)
//   { object, id, toUid }   one record plus what hangs off it (an account's contacts and jobs; tasks and activity)
export const adminReassign = onCall(async (req) => {
  await requireAdmin(req)
  const { fromUid = null, object, id, toUid } = req.data || {}
  const to = await activeMember(toUid)
  const owner = { ownerId: toUid, ownerName: to.name }

  const refs = new Map() // path → ref, so a record reached two ways is written once
  const add = (snap) => snap.docs.forEach((d) => refs.set(d.ref.path, d.ref))
  let main = null // the one record being moved, if any: { ref, ownerName, accountId }
  if (object) {
    const col = `crm_${object}`
    if (!RECORDS.includes(col) || col === 'crm_activities' || !id) throw new HttpsError('invalid-argument', 'Unknown record.')
    const ref = db().doc(`${col}/${id}`)
    const snap = await ref.get()
    if (!snap.exists) throw new HttpsError('not-found', 'This record no longer exists.')
    main = { ref, ownerName: snap.get('ownerName') || 'nobody', accountId: object === 'accounts' ? id : snap.get('accountId') || null }
    refs.set(ref.path, ref)
    const where = (c, field, value) => db().collection(c).where(field, '==', value).get().then(add)
    const jobs = []
    if (object === 'accounts') {
      jobs.push(where('crm_contacts', 'accountId', id), where('crm_opportunities', 'accountId', id),
        where('crm_tasks', 'accountId', id), where('crm_activities', 'accountId', id))
    }
    if (object !== 'tasks') jobs.push(where('crm_tasks', 'relatedId', id), where('crm_activities', 'relatedId', id))
    await Promise.all(jobs)
  } else {
    if (fromUid === toUid) throw new HttpsError('invalid-argument', 'Choose a different person.')
    await Promise.all(RECORDS.map((c) => db().collection(c).where('ownerId', '==', fromUid).get().then(add)))
  }

  // Open SMS drafts follow their lead or job, so the new owner is the one asked to send them.
  const smsFor = new Set([...refs.values()].filter((r) => ['crm_leads', 'crm_opportunities'].includes(r.parent.id)).map((r) => r.id))
  const sms = object
    ? (await Promise.all(chunks([...smsFor], 30).map((ids) => db().collection('crm_sms').where('relatedId', 'in', ids).get())))
      .flatMap((s) => s.docs)
    : (await db().collection('crm_sms').where('ownerId', '==', fromUid).get()).docs
  const openSms = sms.filter((d) => OPEN_SMS.includes(d.get('status')))

  const writer = db().bulkWriter()
  for (const ref of refs.values()) writer.update(ref, owner)
  for (const d of openSms) writer.update(d.ref, owner)
  if (main) {
    const actor = { byId: req.auth.uid, byName: req.auth.token.name || req.auth.token.email || 'Admin' }
    writer.create(db().collection('crm_activities').doc(), {
      type: 'system', subject: `Owner changed from ${main.ownerName} to ${to.name}`, body: '',
      relatedType: object, relatedId: id, accountId: main.accountId,
      ...owner, ...actor, createdAt: Date.now(),
    })
  }
  await writer.close()
  return { moved: refs.size, sms: openSms.length }
})

async function activeMember(uid) {
  if (!uid) throw new HttpsError('invalid-argument', 'Choose who gets the records.')
  const [user, profile] = await Promise.all([
    getAuth().getUser(uid).catch(() => null),
    db().doc(`${USERS}/${uid}`).get().then((s) => s.data()),
  ])
  if (!user) throw new HttpsError('not-found', 'That user no longer exists.')
  const ok = isSuperAdmin(user.email) || (profile?.active === true && ROLES.includes(profile.role))
  if (!ok) throw new HttpsError('failed-precondition', 'Records can only go to someone with active access.')
  return { name: profile?.name || user.displayName || user.email }
}

function chunks(list, n) {
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}
