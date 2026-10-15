<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from './Icon.vue'
import ObjectIcon from './ObjectIcon.vue'
import RecordFormModal from './RecordFormModal.vue'
import SmsCard from './SmsCard.vue'
import { store, logout, updateMyName, toast, isAdmin, isSuperAdminEmail, ROLES } from '../store.js'
import Modal from './Modal.vue'
import { NAV_OBJECTS, OBJECTS } from '../meta/objects.js'
import { searchAll } from '../search.js'
import { initials } from '../format.js'
import { useClickOutside } from '../useClickOutside.js'

const router = useRouter()
const route = useRoute()

const q = ref(route.name === 'search' ? route.query.q || '' : '')
const focused = ref(false)
const active = ref(-1)
const searchEl = ref(null)
useClickOutside(searchEl, () => (focused.value = false))

const suggestions = computed(() => (q.value.trim().length < 2 ? [] : searchAll(q.value).slice(0, 7)))
watch(q, () => (active.value = -1))

function go(item) {
  focused.value = false
  router.push(`/o/${item.object}/${item.record.id}`)
}
function submit() {
  if (active.value >= 0 && suggestions.value[active.value]) return go(suggestions.value[active.value])
  if (!q.value.trim()) return
  focused.value = false
  router.push({ name: 'search', query: { q: q.value.trim() } })
}
function move(d) {
  const n = suggestions.value.length
  if (n) active.value = (active.value + d + n) % n
}

const smsOpen = ref(false)
const smsEl = ref(null)
useClickOutside(smsEl, () => (smsOpen.value = false))
// Admins also see the team's drafts, listed after their own; the badge only counts their own.
const mySms = computed(() => store.sms.filter((d) => d.ownerId === store.user.uid))
const teamSms = computed(() => store.sms.filter((d) => d.ownerId !== store.user.uid))
const smsWaiting = computed(() => mySms.value.filter((d) => d.status === 'pending' || d.status === 'failed').length)

const createOpen = ref(false)
const createEl = ref(null)
useClickOutside(createEl, () => (createOpen.value = false))
const creating = ref(null)

const userOpen = ref(false)
const userEl = ref(null)
useClickOutside(userEl, () => (userOpen.value = false))

const renaming = ref(false)
const newName = ref('')
const savingName = ref(false)
// Mirrors ownerCallName in functions/sms.js: first name, keeping a leading title ("Mr Sam").
const callName = computed(() => {
  const w = newName.value.trim().split(/\s+/).filter(Boolean)
  return /^(mr|mrs|ms|miss|mx|dr|prof|eng|bw|bi|sir|madam)\.?$/i.test(w[0] || '') && w[1] ? `${w[0]} ${w[1]}` : w[0] || ''
})
function startRename() {
  newName.value = store.user.name
  renaming.value = true
  userOpen.value = false
}
async function saveName() {
  const name = newName.value.trim()
  if (!name) return
  savingName.value = true
  try {
    const n = await updateMyName(name)
    toast(`Your name is now ${name}${n ? ` (updated on ${n} records)` : ''}.`)
    renaming.value = false
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    savingName.value = false
  }
}

async function doLogout() {
  await logout()
  router.push('/login')
}
</script>

<template>
  <header class="global-header">
    <RouterLink to="/" class="logo" aria-label="HaflaCREM home">
      <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden="true">
        <path d="M11 26a9 9 0 0 1-1.6-17.9A10 10 0 0 1 28.6 6 8 8 0 1 1 31 26z" fill="#0176d3" />
        <text x="20" y="20" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="Segoe UI, Arial">HC</text>
      </svg>
    </RouterLink>

    <div ref="searchEl" class="search" :class="{ open: focused && q.trim().length >= 2 }">
      <Icon name="search" class="search-icon" />
      <input
        v-model="q" class="search-input" placeholder="Search leads, accounts, contacts, opportunities..."
        aria-label="Search" @focus="focused = true" @keydown.enter.prevent="submit"
        @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="focused = false"
      />
      <div v-if="focused && q.trim().length >= 2" class="search-menu">
        <button
          v-for="(s, i) in suggestions" :key="s.object + s.record.id" class="search-item"
          :class="{ active: i === active }" @mousedown.prevent="go(s)"
        >
          <ObjectIcon :object="s.object" size="small" />
          <span class="truncate">
            <span class="search-name">{{ s.name }}</span>
            <span class="muted small"> · {{ OBJECTS[s.object].label }}<template v-if="s.detail"> · {{ s.detail }}</template></span>
          </span>
        </button>
        <button class="search-item all" @mousedown.prevent="submit">
          <Icon name="search" /> Show more results for "{{ q.trim() }}"
        </button>
      </div>
    </div>

    <div class="actions">
      <div ref="smsEl" class="dropdown">
        <button class="header-btn sms-btn" :title="smsWaiting ? `${smsWaiting} SMS waiting for you` : 'SMS'" :aria-label="`SMS inbox, ${smsWaiting} waiting`"
          @click="smsOpen = !smsOpen">
          <Icon name="sms" :size="18" />
          <span v-if="smsWaiting" class="sms-badge">{{ smsWaiting }}</span>
        </button>
        <div v-if="smsOpen" class="menu right sms-inbox">
          <div class="menu-heading">SMS waiting for you</div>
          <div v-if="!mySms.length" class="sms-empty muted">Nothing to approve. New messages for your leads and jobs appear here.</div>
          <SmsCard v-for="d in mySms" :key="d.id" :draft="d" class="sms-item" @navigate="smsOpen = false" />
          <template v-if="teamSms.length">
            <div class="menu-heading team-heading">Team SMS ({{ teamSms.length }})</div>
            <SmsCard v-for="d in teamSms" :key="d.id" :draft="d" class="sms-item" @navigate="smsOpen = false" />
          </template>
        </div>
      </div>
      <div ref="createEl" class="dropdown">
        <button class="header-btn add" title="Global Actions" aria-label="Create new" @click="createOpen = !createOpen">
          <Icon name="add" :size="14" />
        </button>
        <div v-if="createOpen" class="menu right">
          <div class="menu-heading">Create</div>
          <button v-for="o in NAV_OBJECTS" :key="o" class="menu-item" @click="creating = o; createOpen = false">
            <ObjectIcon :object="o" size="small" /> New {{ OBJECTS[o].label }}
          </button>
        </div>
      </div>
      <RouterLink to="/dashboard" class="header-btn" title="Dashboard"><Icon name="chart" :size="18" /></RouterLink>
      <div ref="userEl" class="dropdown">
        <button class="avatar-btn" :aria-label="'User menu for ' + store.user.name" @click="userOpen = !userOpen">
          <span class="avatar" style="width: 32px; height: 32px; font-size: 12px">{{ initials(store.user.name) }}</span>
        </button>
        <div v-if="userOpen" class="menu right user-menu">
          <div class="user-card">
            <span class="avatar" style="width: 48px; height: 48px; font-size: 16px">{{ initials(store.user.name) }}</span>
            <div>
              <div style="font-weight: 700; font-size: 16px">{{ store.user.name }}</div>
              <div class="muted small">{{ store.user.email }}</div>
              <div class="muted small">{{ isSuperAdminEmail(store.user.email) ? 'Super Admin' : ROLES[store.user.role] }}</div>
            </div>
          </div>
          <div class="menu-divider" />
          <button class="menu-item" @click="startRename"><Icon name="edit" /> Change your name</button>
          <template v-if="isAdmin()">
            <RouterLink to="/setup/users" class="menu-item" @click="userOpen = false"><Icon name="user" /> Users &amp; Access</RouterLink>
            <RouterLink to="/setup/import" class="menu-item" @click="userOpen = false"><Icon name="refresh" /> Import from Haflaway CRM</RouterLink>
          </template>
          <div class="menu-divider" />
          <button class="menu-item" @click="doLogout"><Icon name="logout" /> Log Out</button>
        </div>
      </div>
    </div>
  </header>

  <Modal v-if="renaming" small title="Change your name" @close="renaming = false">
    <form class="form-element" @submit.prevent="saveName">
      <label for="my-name">Your name</label>
      <input id="my-name" v-model="newName" class="input" maxlength="60" autofocus />
      <p class="muted small" style="margin-top: 8px">Shown as the owner of your leads and jobs, and in SMS to clients, e.g. "{{ callName || 'Name' }} atakupigia hivi karibuni".</p>
    </form>
    <template #footer>
      <button class="btn" @click="renaming = false">Cancel</button>
      <button class="btn btn-brand" :disabled="savingName || !newName.trim()" @click="saveName">{{ savingName ? 'Saving…' : 'Save' }}</button>
    </template>
  </Modal>

  <RecordFormModal v-if="creating" :object="creating" @close="creating = null"
    @saved="(id) => { router.push(`/o/${creating}/${id}`); creating = null }" />
</template>

<style scoped>
.global-header {
  height: 50px; background: var(--surface); display: flex; align-items: center; gap: 16px; padding: 0 16px;
  box-shadow: 0 1px 0 var(--border-light);
}
.logo { display: flex; align-items: center; width: 200px; }
.search { position: relative; flex: 0 1 600px; margin: 0 auto; }
.search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-weak); }
.search-input {
  width: 100%; height: 32px; border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px 0 36px;
  background: var(--surface);
}
.search-input:focus { outline: none; border-color: var(--brand); box-shadow: var(--focus); }
.search-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--surface); z-index: 60;
  border: 1px solid var(--border-light); border-radius: var(--radius); box-shadow: var(--shadow-drop); padding: 4px 0;
}
.search-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 12px; background: none; border: 0; text-align: left; cursor: pointer; }
.search-item:hover, .search-item.active { background: var(--bg); }
.search-item.all { color: var(--brand); border-top: 1px solid var(--border-light); padding: 10px 12px; }
.search-name { font-weight: 600; }
.actions { display: flex; align-items: center; gap: 8px; width: 200px; justify-content: flex-end; }
.header-btn {
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius);
  color: var(--text-weak); background: none; border: 0; cursor: pointer;
}
.header-btn:hover { background: var(--bg); color: var(--brand); text-decoration: none; }
.header-btn.add { width: 22px; height: 22px; border: 2px solid var(--text-weak); border-radius: 4px; }
.header-btn.add:hover { border-color: var(--brand); }
.avatar-btn { background: none; border: 0; padding: 0; cursor: pointer; border-radius: 50%; display: flex; }
.user-menu { width: 280px; }
.sms-btn { position: relative; }
.sms-badge {
  position: absolute; top: -2px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: var(--error-bright); color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center;
}
.sms-inbox { width: 380px; max-height: calc(100vh - 80px); overflow-y: auto; padding-bottom: 0; }
.sms-item { border-top: 1px solid var(--border-light); }
.sms-empty { padding: 12px; }
.team-heading { border-top: 1px solid var(--border-light); padding-top: 10px; margin-top: 4px; }
@media (max-width: 640px) { .sms-inbox { position: fixed; top: 50px; left: 8px; right: 8px; width: auto; } }
.user-card { display: flex; gap: 12px; align-items: center; padding: 12px; }
@media (max-width: 800px) { .logo, .actions { width: auto; } }
@media (max-width: 640px) { .global-header { gap: 8px; padding: 0 8px; } .actions { gap: 4px; } }
</style>
