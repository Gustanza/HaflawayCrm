// End-to-end check of the SMS approval flow against the local emulators (never sends real SMS).
//   1. npm run emulators          (needs Java; uses functions/.env.demo-haflacrem → SMS_DRY_RUN=true)
//   2. node scripts/sms-emulator-test.mjs
import assert from 'node:assert/strict'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, collection, doc, addDoc, updateDoc, getDoc, getDocs, setDoc, query, where } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'

const REGION = 'us-central1'
let n = 0
function client(name) {
  const app = initializeApp({ apiKey: 'demo', projectId: 'demo-haflacrem' }, `${name}-${Date.now()}-${n++}`)
  const auth = getAuth(app), db = getFirestore(app), fn = getFunctions(app, REGION)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(fn, '127.0.0.1', 5001)
  return { auth, db, call: (f, data) => httpsCallable(fn, f)(data).then((r) => r.data) }
}
async function signUp(c, email, name) {
  const { user } = await createUserWithEmailAndPassword(c.auth, email, 'password123')
  await updateProfile(user, { displayName: name })
  await user.getIdToken(true)
  return user
}
// The admin creates the account (or gives an existing one access), then the person signs in.
async function teamMember(c, email, name, role = 'rep') {
  await admin.call('adminCreateUser', { name, email, password: 'password123', role })
  return (await signInWithEmailAndPassword(c.auth, email, 'password123')).user
}
async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 400))
  }
}
const drafts = async (c, uid, relatedId) =>
  (await getDocs(query(collection(c.db, 'crm_sms'), where('ownerId', '==', uid)))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.relatedId === relatedId)
const rejects = (p, code) => assert.rejects(p, (e) => (assert.match(e.code, new RegExp(code)), true))
const ok = (msg) => console.log('✔', msg)

const tag = Date.now()
// The super admin (haflaway@gmail.com) is an admin by email; everyone else gets access from an admin.
const admin = client('admin')
const adminUser = await signUp(admin, 'haflaway@gmail.com', 'Hafla Admin').catch(async () =>
  (await signInWithEmailAndPassword(admin.auth, 'haflaway@gmail.com', 'password123')).user)
const staff = client('staff'), stranger = client('stranger')
const me = await teamMember(staff, `staff+${tag}@example.com`, 'Godwill Sam') // a rep, but not on the SMS allowlist
// The allowlist in .env.demo-haflacrem is staff@example.com.
const allowed = client('allowed')
const boss = await teamMember(allowed, 'staff@example.com', 'Godwill Sam')
await signUp(stranger, `stranger+${tag}@example.com`, 'Stranger') // signed up through the API: no access
const owner = { ownerId: boss.uid, ownerName: 'Godwill Sam' }

// 1. New lead → welcome draft for its owner, with the number normalised.
const now = Date.now()
const lead = await addDoc(collection(allowed.db, 'crm_leads'), { firstName: 'Neema', lastName: 'Juma', company: 'Harusi ya Neema', phone: '0712 345 678', status: 'New', service: 'Kadi za Michango', ...owner, createdAt: now, updatedAt: now })
const [welcome] = await waitFor(async () => (await drafts(allowed, boss.uid, lead.id)).filter((d) => d.status === 'pending').length && drafts(allowed, boss.uid, lead.id), 'welcome draft')
assert.equal(welcome.kind, 'lead_welcome')
assert.equal(welcome.phone, '255712345678')
assert.match(welcome.content, /^Habari Neema, .*Godwill atakupigia .*Kadi za Michango/)
ok(`lead created → draft: "${welcome.content}"`)

// 2. Imported leads never prompt.
const imported = await addDoc(collection(allowed.db, 'crm_leads'), { lastName: 'Old', phone: '0712000000', status: 'New', legacy: { app: 'x' }, ...owner, createdAt: now, updatedAt: now })
await new Promise((r) => setTimeout(r, 3000))
assert.equal((await drafts(allowed, boss.uid, imported.id)).length, 0)
ok('imported lead → no draft')

// 3. Security: other users can't read or write drafts, and non-staff can't send.
await rejects(getDoc(doc(stranger.db, 'crm_sms', welcome.id)), 'permission-denied')
await rejects(setDoc(doc(stranger.db, 'crm_sms', 'forged'), { ownerId: 'x', status: 'scheduled' }), 'permission-denied')
await rejects(setDoc(doc(allowed.db, 'crm_sms', welcome.id), { status: 'sent' }), 'permission-denied')
await rejects(stranger.call('smsSend', { id: welcome.id, content: 'hi', phone: '0712345678', when: 'now' }), 'permission-denied')
const meClient = staff // signed up but not on the allowlist
await rejects(meClient.call('smsCancel', { id: welcome.id }), 'permission-denied')
ok('drafts are owner-read-only, unwritable from the app, and only allowlisted staff can send')

// 4. Validation.
await rejects(allowed.call('smsSend', { id: welcome.id, content: 'hi', phone: '123', when: 'now' }), 'invalid-argument')
await rejects(allowed.call('smsSend', { id: welcome.id, content: '   ', phone: '0712345678', when: 'now' }), 'invalid-argument')
ok('bad phone / empty message refused')

// 5. Quiet hours (only checkable when the test runs between 20:00 and 08:00 EAT).
const eatHour = new Date(Date.now() + 3 * 3600000).getUTCHours()
if (eatHour >= 20 || eatHour < 8) {
  await rejects(allowed.call('smsSend', { id: welcome.id, content: welcome.content, phone: welcome.phone }), 'failed-precondition')
  ok('quiet hours → asks to schedule or send anyway')
}

// 6. Send with an edited message and number → sent, logged on the timeline; can't send twice.
const edited = welcome.content + ' (Neema)'
const res = await allowed.call('smsSend', { id: welcome.id, content: edited, phone: '+255 755 111 222', when: 'now' })
assert.equal(res.status, 'sent')
const sent = (await getDoc(doc(allowed.db, 'crm_sms', welcome.id))).data()
assert.equal(sent.status, 'sent')
assert.equal(sent.sentPhone, '255755111222')
assert.equal(sent.phoneEdited, true)
assert.equal(sent.contentEdited, true)
assert.match(sent.campaignId, /^dryrun-/)
const acts = (await getDocs(query(collection(allowed.db, 'crm_activities'), where('ownerId', '==', boss.uid), where('smsId', '==', welcome.id)))).docs
assert.equal(acts.length, 1)
assert.equal(acts[0].get('type'), 'sms')
await rejects(allowed.call('smsSend', { id: welcome.id, content: edited, phone: '0755111222', when: 'now' }), 'failed-precondition')
ok('edited SMS sent (dry run), logged on the timeline, double-send refused')

// 7. Job stages: Quote Sent prompts; moving back retires it; cancel works.
const contact = await addDoc(collection(allowed.db, 'crm_contacts'), { firstName: 'Baraka', lastName: 'M', mobile: '0687 654 321', ...owner, createdAt: now })
const opp = await addDoc(collection(allowed.db, 'crm_opportunities'), { name: 'Harusi - Kadi', contactId: contact.id, service: 'Kadi za Michango', stage: 'Inquiry', amount: 350000, amountPaid: 0, balance: 350000, ...owner, createdAt: now, updatedAt: now })
await new Promise((r) => setTimeout(r, 2000))
assert.equal((await drafts(allowed, boss.uid, opp.id)).length, 0)
await updateDoc(opp, { stage: 'Quote Sent' })
const quote = (await waitFor(async () => (await drafts(allowed, boss.uid, opp.id)).find((d) => d.kind === 'quote_sent' && d.status === 'pending'), 'quote draft'))
assert.equal(quote.phone, '255687654321')
assert.match(quote.content, /Habari Baraka, bei ya Kadi za Michango ni TZS 350,000\. .*Lipa Namba/)
ok(`Quote Sent → draft to the contact's mobile: "${quote.content}"`)
await updateDoc(opp, { stage: 'Inquiry' })
await waitFor(async () => (await getDoc(doc(allowed.db, 'crm_sms', quote.id))).get('status') === 'outdated', 'outdated quote')
ok('moved back to Inquiry → quote draft retired (mis-drag safe)')
await updateDoc(opp, { stage: 'Quote Sent' })
const quote2 = await waitFor(async () => (await drafts(allowed, boss.uid, opp.id)).find((d) => d.kind === 'quote_sent' && d.status === 'pending'), 'second quote draft')
await allowed.call('smsCancel', { id: quote2.id })
assert.equal((await getDoc(doc(allowed.db, 'crm_sms', quote2.id))).get('status'), 'cancelled')
ok('Cancel → cancelled, nothing sent')

// 8. Payments: two unsent payments become one receipt for the total.
await updateDoc(opp, { amountPaid: 100000, balance: 250000 })
const r1 = await waitFor(async () => (await drafts(allowed, boss.uid, opp.id)).find((d) => d.kind === 'payment_received' && d.status === 'pending'), 'receipt')
await updateDoc(opp, { amountPaid: 150000, balance: 200000 })
const r2 = await waitFor(async () => (await drafts(allowed, boss.uid, opp.id)).find((d) => d.kind === 'payment_received' && d.status === 'pending' && d.id !== r1.id), 'second receipt')
assert.equal((await getDoc(doc(allowed.db, 'crm_sms', r1.id))).get('status'), 'outdated')
assert.match(r2.content, /TZS 150,000\. Salio lililobaki ni TZS 200,000/)
ok(`payments merged into one receipt: "${r2.content}"`)

// 9. Roles: reps only see and change their own records; only admins manage people and owners.
const mine = (c, uid, col) => getDocs(query(collection(c.db, col), where('ownerId', '==', uid)))
await rejects(getDoc(doc(staff.db, 'crm_leads', lead.id)), 'permission-denied')
await rejects(getDocs(collection(staff.db, 'crm_leads')), 'permission-denied') // a rep can't list everyone's
await rejects(getDocs(collection(stranger.db, 'crm_leads')), 'permission-denied')
await rejects(addDoc(collection(staff.db, 'crm_leads'), { lastName: 'X', ...owner, createdAt: now }), 'permission-denied')
await rejects(updateDoc(doc(allowed.db, 'crm_leads', lead.id), { ownerId: me.uid }), 'permission-denied') // can't give records away
await rejects(updateDoc(doc(staff.db, 'crm_users', me.uid), { role: 'admin' }), 'permission-denied')
await rejects(setDoc(doc(stranger.db, 'crm_users', stranger.auth.currentUser.uid), { name: 'S', role: 'admin', active: true }), 'permission-denied')
await rejects(staff.call('adminCreateUser', { name: 'X', email: `x+${tag}@example.com`, password: 'password123', role: 'admin' }), 'permission-denied')
await updateDoc(doc(staff.db, 'crm_users', me.uid), { name: 'Godwill S' }) // renaming yourself is fine
assert.ok((await mine(staff, me.uid, 'crm_leads')).size === 0)
assert.ok((await getDocs(collection(admin.db, 'crm_leads'))).size >= 2) // admins see everything
ok("reps can't read, list, create for, or hand off other people's records, or change roles; admins see all")

// Admin cancels a rep's SMS draft, then moves the rep's job (with its open drafts) to another rep.
await updateDoc(opp, { stage: 'Client Approval' })
const approval = await waitFor(async () => (await drafts(allowed, boss.uid, opp.id)).find((d) => d.kind === 'client_approval' && d.status === 'pending'), 'design draft')
const res2 = await admin.call('adminReassign', { object: 'opportunities', id: opp.id, toUid: me.uid })
assert.ok(res2.moved >= 1 && res2.sms >= 1)
assert.equal((await getDoc(doc(staff.db, 'crm_opportunities', opp.id))).get('ownerId'), me.uid)
assert.equal((await getDoc(doc(staff.db, 'crm_sms', approval.id))).get('ownerId'), me.uid)
await rejects(getDoc(doc(allowed.db, 'crm_opportunities', opp.id)), 'permission-denied')
await admin.call('smsCancel', { id: approval.id })
ok('admin moved a job and its waiting SMS to another rep, and can act on any draft')

// Deactivate → signed out of the data; reactivate → back.
await admin.call('adminUpdateUser', { uid: me.uid, active: false })
await rejects(getDoc(doc(staff.db, 'crm_opportunities', opp.id)), 'permission-denied')
await admin.call('adminUpdateUser', { uid: me.uid, active: true })
await rejects(admin.call('adminUpdateUser', { uid: adminUser.uid, role: 'rep' }), 'failed-precondition') // the super admin (here also yourself) cannot be changed
ok('deactivating cuts access immediately; the super admin cannot be changed')

console.log('\nAll SMS and access checks passed.')
process.exit(0)
