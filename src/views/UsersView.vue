<script setup>
// Admin only: who can use HaflaCREM, what they can do, and who owns which records.
import { ref, reactive, computed } from 'vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import {
  store, ROLES, roleOfProfile, isSuperAdminEmail, teamMembers, toast,
  adminCreateUser, adminUpdateUser, adminSetPassword, adminReassign,
} from '../store.js'
import { date } from '../format.js'

const OWNED = ['leads', 'accounts', 'contacts', 'opportunities', 'tasks']

// Records per owner id ('' = no owner), for the counts and the "Move records" choices.
const counts = computed(() => {
  const out = {}
  for (const c of OWNED) for (const r of store[c]) out[r.ownerId || ''] = (out[r.ownerId || ''] || 0) + 1
  return out
})

const status = (u) => (roleOfProfile(u) ? 'active' : u.active === false ? 'deactivated' : 'pending')
const STATUS = { active: ['Active', 'success'], pending: ['Waiting for access', 'warning'], deactivated: ['Deactivated', 'inverse'] }

const people = computed(() =>
  store.users.map((u) => ({
    ...u,
    status: status(u),
    superAdmin: isSuperAdminEmail(u.email),
    me: u.id === store.user.uid,
    records: counts.value[u.id] || 0,
  })).sort((a, b) => rank(a) - rank(b)), // store.users is already sorted by name
)
// Super admin first, then people waiting for access, then everyone else.
const rank = (u) => (u.superAdmin ? 0 : u.status === 'pending' ? 1 : u.status === 'active' ? 2 : 3)
const pendingCount = computed(() => people.value.filter((u) => u.status === 'pending').length)

// Records whose owner isn't on the team list: never assigned, or owned by an account from the old Haflaway app.
const orphans = computed(() => {
  const known = new Set(store.users.map((u) => u.id))
  const groups = {}
  for (const c of OWNED) {
    for (const r of store[c]) {
      const id = r.ownerId || ''
      if (id && known.has(id)) continue
      groups[id] ??= { id: id || null, name: id ? r.ownerName || 'Unknown person' : 'No owner', records: 0 }
      groups[id].records++
    }
  }
  return Object.values(groups)
})

/* ---------------- Dialogs ---------------- */

const dialog = ref(null) // { kind: 'new' | 'access' | 'password' | 'deactivate' | 'move', user }
const busy = ref(false)
const form = reactive({ name: '', email: '', password: '', role: 'rep', toUid: '' })

function open(kind, user = null) {
  Object.assign(form, { name: '', email: '', password: kind === 'new' || kind === 'password' ? newPassword() : '', role: 'rep', toUid: '' })
  dialog.value = { kind, user }
}

// Readable temporary password (no 0/O, 1/l look-alikes) for the admin to pass on.
function newPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => chars[n % chars.length]).join('')
}

async function run(fn, done) {
  busy.value = true
  try {
    const res = await fn()
    toast(typeof done === 'function' ? done(res) : done)
    dialog.value = null
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    busy.value = false
  }
}

const createUser = () => run(
  () => adminCreateUser({ name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role }),
  (res) => res.existing
    ? `${form.email.trim()} already had an account. It now has access and keeps its current password.`
    : `${form.name.trim()} can now log in as ${form.email.trim()}.`,
)
const grantAccess = (u) => run(() => adminUpdateUser({ uid: u.id, role: form.role, active: true }), `${u.name || u.email} now has access as ${ROLES[form.role]}.`)
const changeRole = (u, role) => run(() => adminUpdateUser({ uid: u.id, role }), `${u.name || u.email} is now ${ROLES[role]}.`)
const deactivate = (u) => run(() => adminUpdateUser({ uid: u.id, active: false }), `${u.name || u.email} was deactivated and signed out.`)
const reactivate = (u) => run(() => adminUpdateUser({ uid: u.id, active: true, role: u.role || 'rep' }), `${u.name || u.email} has access again.`)
const setPassword = (u) => run(() => adminSetPassword({ uid: u.id, password: form.password }), `Password changed for ${u.name || u.email}. Share the new one with them.`)
const move = (from) => run(
  () => adminReassign({ fromUid: from.id, toUid: form.toUid }),
  (res) => `${res.moved} records moved to ${teamMembers().find((u) => u.id === form.toUid)?.name || 'them'}.`,
)

const moveTargets = computed(() => teamMembers().filter((u) => u.id !== dialog.value?.user?.id))
const validNew = computed(() => form.name.trim() && /^\S+@\S+\.\S+$/.test(form.email.trim()) && form.password.length >= 6)
</script>

<template>
  <div class="page stack">
    <div class="card page-header">
      <span class="obj-tile"><Icon name="user" :size="20" /></span>
      <div>
        <div class="eyebrow">Setup</div>
        <h1 class="title">Users &amp; Access</h1>
        <div class="meta muted small">Admins see and manage everything. Sales reps only see the records they own.</div>
      </div>
      <span class="spacer" />
      <button class="btn btn-brand" @click="open('new')">New User</button>
    </div>

    <div v-if="pendingCount" class="alert warning">
      <Icon name="warning" /> {{ pendingCount }} {{ pendingCount === 1 ? 'person is' : 'people are' }} waiting for access. Give them a role below, or leave them without access.
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Team ({{ people.length }})</span></div>
      <div class="table-wrap">
        <table class="table cards">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th class="num">Records</th><th>Added</th><th /></tr></thead>
          <tbody>
            <tr v-for="u in people" :key="u.id">
              <td class="primary">
                {{ u.name || u.email }}
                <span v-if="u.me" class="badge info">You</span>
              </td>
              <td data-label="Email">{{ u.email }}</td>
              <td data-label="Role">
                <template v-if="u.superAdmin">Super Admin</template>
                <select v-else-if="u.status === 'active' && !u.me" class="select role-select" :value="u.role" :disabled="busy"
                  :aria-label="`Role for ${u.name || u.email}`" @change="changeRole(u, $event.target.value)">
                  <option v-for="(label, key) in ROLES" :key="key" :value="key">{{ label }}</option>
                </select>
                <template v-else>{{ ROLES[u.role] || '—' }}</template>
              </td>
              <td data-label="Status"><span class="badge" :class="STATUS[u.status][1]">{{ STATUS[u.status][0] }}</span></td>
              <td data-label="Records" class="num">
                <RouterLink v-if="u.records" :to="`/o/leads?view=all&owner=${u.id}`">{{ u.records }}</RouterLink>
                <template v-else>0</template>
              </td>
              <td data-label="Added">{{ date(u.createdAt) }}</td>
              <td class="actions">
                <template v-if="!u.superAdmin && !u.me">
                  <button v-if="u.status === 'pending'" class="btn btn-brand" @click="open('access', u)">Give access</button>
                  <button v-if="u.status === 'deactivated'" class="btn" :disabled="busy" @click="reactivate(u)">Reactivate</button>
                  <button v-if="u.status === 'active'" class="btn" @click="open('password', u)">Reset password</button>
                  <button v-if="u.status === 'active'" class="btn" @click="open('deactivate', u)">Deactivate</button>
                </template>
                <button v-if="u.records" class="btn" @click="open('move', u)">Move records</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="orphans.length" class="card">
      <div class="card-header">
        <span class="card-title">Records Without a Team Owner</span>
        <span class="muted small">Only admins see these. Give them to someone so they show up in a rep's list.</span>
      </div>
      <div class="table-wrap">
        <table class="table cards">
          <thead><tr><th>Owner on the record</th><th class="num">Records</th><th /></tr></thead>
          <tbody>
            <tr v-for="o in orphans" :key="o.id || 'none'">
              <td class="primary">{{ o.name }}<span v-if="o.id" class="muted small"> (not on the team list, e.g. from the old Haflaway CRM)</span></td>
              <td data-label="Records" class="num"><RouterLink :to="`/o/leads?view=all&owner=${o.id || 'none'}`">{{ o.records }}</RouterLink></td>
              <td class="actions"><button class="btn" @click="open('move', o)">Move records</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- New user -->
    <Modal v-if="dialog?.kind === 'new'" small title="New User" @close="dialog = null">
      <form class="stack" @submit.prevent="validNew && createUser()">
        <div class="form-element"><label for="nu-name">Full name</label><input id="nu-name" v-model="form.name" class="input" autocomplete="off" /></div>
        <div class="form-element"><label for="nu-email">Email</label><input id="nu-email" v-model="form.email" class="input" type="email" autocomplete="off" /></div>
        <div class="form-element">
          <label for="nu-pass">Temporary password</label>
          <div class="row">
            <input id="nu-pass" v-model="form.password" class="input" autocomplete="new-password" />
            <button type="button" class="btn" @click="form.password = newPassword()">New</button>
          </div>
          <div class="muted small" style="margin-top: 4px">Share it with them. At least 6 characters.</div>
        </div>
        <div class="form-element">
          <label for="nu-role">Role</label>
          <select id="nu-role" v-model="form.role" class="select">
            <option value="rep">Sales Rep: sees and works only their own records</option>
            <option value="admin">Admin: sees everything and manages users</option>
          </select>
        </div>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <button class="btn" @click="dialog = null">Cancel</button>
        <button class="btn btn-brand" :disabled="busy || !validNew" @click="createUser">{{ busy ? 'Creating…' : 'Create User' }}</button>
      </template>
    </Modal>

    <!-- Give access to someone waiting -->
    <Modal v-if="dialog?.kind === 'access'" small title="Give Access" @close="dialog = null">
      <div class="form-element">
        <p style="margin-bottom: 12px"><strong>{{ dialog.user.name || dialog.user.email }}</strong> ({{ dialog.user.email }}) has an account but no access yet.</p>
        <label for="ga-role">Role</label>
        <select id="ga-role" v-model="form.role" class="select">
          <option value="rep">Sales Rep: sees and works only their own records</option>
          <option value="admin">Admin: sees everything and manages users</option>
        </select>
      </div>
      <template #footer>
        <button class="btn" @click="dialog = null">Cancel</button>
        <button class="btn btn-brand" :disabled="busy" @click="grantAccess(dialog.user)">Give Access</button>
      </template>
    </Modal>

    <!-- Reset password -->
    <Modal v-if="dialog?.kind === 'password'" small title="Reset Password" @close="dialog = null">
      <div class="form-element">
        <label for="rp-pass">New password for {{ dialog.user.name || dialog.user.email }}</label>
        <div class="row">
          <input id="rp-pass" v-model="form.password" class="input" autocomplete="new-password" />
          <button type="button" class="btn" @click="form.password = newPassword()">New</button>
        </div>
        <div class="muted small" style="margin-top: 4px">They'll be signed out everywhere and log in with this password.</div>
      </div>
      <template #footer>
        <button class="btn" @click="dialog = null">Cancel</button>
        <button class="btn btn-brand" :disabled="busy || form.password.length < 6" @click="setPassword(dialog.user)">Set Password</button>
      </template>
    </Modal>

    <!-- Deactivate -->
    <Modal v-if="dialog?.kind === 'deactivate'" small title="Deactivate User" @close="dialog = null">
      <p><strong>{{ dialog.user.name || dialog.user.email }}</strong> will be signed out and can't log in until you reactivate them.</p>
      <p class="muted" style="margin-top: 8px">
        Their {{ dialog.user.records }} records stay as they are.<template v-if="dialog.user.records"> Use <strong>Move records</strong> to give them to someone else.</template>
      </p>
      <template #footer>
        <button class="btn" @click="dialog = null">Cancel</button>
        <button class="btn btn-destructive" :disabled="busy" @click="deactivate(dialog.user)">Deactivate</button>
      </template>
    </Modal>

    <!-- Move records -->
    <Modal v-if="dialog?.kind === 'move'" small title="Move Records" @close="dialog = null">
      <div class="form-element">
        <p style="margin-bottom: 12px">
          Move all {{ dialog.user.records }} records owned by <strong>{{ dialog.user.name || dialog.user.email }}</strong>
          (leads, accounts, contacts, opportunities, tasks and their activity) to:
        </p>
        <select v-model="form.toUid" class="select" aria-label="New owner">
          <option value="" disabled>Choose a person…</option>
          <option v-for="u in moveTargets" :key="u.id" :value="u.id">{{ u.name || u.email }}</option>
        </select>
        <div class="muted small" style="margin-top: 8px">SMS waiting to be sent for these records move too.</div>
      </div>
      <template #footer>
        <button class="btn" @click="dialog = null">Cancel</button>
        <button class="btn btn-brand" :disabled="busy || !form.toUid" @click="move(dialog.user)">{{ busy ? 'Moving…' : 'Move Records' }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.obj-tile { width: 32px; height: 32px; border-radius: 4px; background: #7f8de1; color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.meta { margin-top: 2px; }
.role-select { width: 140px; height: 28px; }
.actions { white-space: nowrap; text-align: right; max-width: none; }
.actions .btn + .btn { margin-left: 6px; }
@media (max-width: 640px) {
  .table.cards td.actions { grid-column: 1 / -1; text-align: left; white-space: normal; padding-top: 8px; }
  .actions .btn { margin: 4px 6px 0 0; }
  .actions .btn + .btn { margin-left: 0; }
}
</style>
