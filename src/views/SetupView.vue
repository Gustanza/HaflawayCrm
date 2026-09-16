<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import {
  registerOrganization,
  createTeamMember,
  adoptExistingUser,
  ASSIGNABLE_ROLES,
} from '@/services/provisioning.service.js'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

/* ------------------------------------------------------------- org bootstrap */

const companyName = ref('')
const orgDisplayName = ref('')
const orgBusy = ref(false)
const orgError = ref(null)
const orgDone = ref(false)

async function createOrg() {
  orgError.value = null
  orgBusy.value = true
  try {
    await registerOrganization({
      user: { uid: auth.uid, email: auth.user?.email },
      companyName: companyName.value,
      displayName: orgDisplayName.value,
    })
    orgDone.value = true
  } catch (error) {
    orgError.value = error?.message || t('auth.error.generic')
  } finally {
    orgBusy.value = false
  }
}

async function checkClaims() {
  await auth.refreshClaims()
}

/* --------------------------------------------------------- add a team member */

const ERROR_KEY = {
  'email-taken': 'setup.errorEmailTaken',
  'invalid-email': 'setup.errorInvalidEmail',
  'invalid-uid': 'setup.errorInvalidUid',
  'already-provisioned': 'setup.errorAlreadyProvisioned',
}

/** 'create' | 'adopt' */
const mode = ref('create')
const email = ref('')
const uid = ref('')
const memberName = ref('')
const role = ref('agent')
const teamId = ref('')
const memberBusy = ref(false)
const memberError = ref(null)
const created = ref(null) // { email, resetEmailSent } | { uid }

async function addMember() {
  memberError.value = null
  memberBusy.value = true
  const actor = { uid: auth.uid, orgId: auth.orgId }
  try {
    if (mode.value === 'create') {
      const result = await createTeamMember({
        email: email.value,
        displayName: memberName.value,
        role: role.value,
        teamId: teamId.value,
        actor,
      })
      created.value = { email: email.value.trim(), resetEmailSent: result.resetEmailSent }
    } else {
      await adoptExistingUser({
        uid: uid.value,
        email: email.value,
        displayName: memberName.value,
        role: role.value,
        teamId: teamId.value,
        actor,
      })
      created.value = { email: email.value.trim() || uid.value.trim() }
    }
    ui.success(t('setup.created'))
    email.value = ''
    uid.value = ''
    memberName.value = ''
    teamId.value = ''
  } catch (error) {
    memberError.value = t(ERROR_KEY[error?.code] ?? 'auth.error.generic')
  } finally {
    memberBusy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg px-4 py-6">
    <h1 class="text-xl font-semibold text-slate-900">{{ t('setup.title') }}</h1>
    <p class="mt-1 text-sm text-slate-600">{{ t('setup.subtitle') }}</p>

    <!-- Step 1: no org yet -->
    <section v-if="!auth.isProvisioned" class="card mt-5 p-4">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">{{ t('setup.orgTitle') }}</h2>
      <p class="mt-1 text-sm text-slate-600">{{ t('setup.orgBody') }}</p>

      <template v-if="orgDone">
        <p class="mt-3 text-sm font-medium text-emerald-700">{{ t('setup.orgCreated') }}</p>
        <button type="button" class="btn-primary mt-3 w-full" @click="checkClaims">
          {{ t('auth.noAccess.checkAgain') }}
        </button>
      </template>
      <form v-else class="mt-3 space-y-3" @submit.prevent="createOrg">
        <div>
          <label for="setup-company" class="field-label">{{ t('auth.register.companyName') }}</label>
          <input id="setup-company" v-model="companyName" type="text" required class="field-input" />
        </div>
        <div>
          <label for="setup-your-name" class="field-label">{{ t('auth.register.displayName') }}</label>
          <input id="setup-your-name" v-model="orgDisplayName" type="text" required class="field-input" />
        </div>
        <p v-if="orgError" class="field-error" role="alert">{{ orgError }}</p>
        <button type="submit" class="btn-primary w-full" :disabled="orgBusy">
          {{ orgBusy ? t('common.loading') : t('setup.orgAction') }}
        </button>
      </form>
    </section>

    <!-- Step 2: add colleagues -->
    <section v-else-if="auth.isAdmin" class="card mt-5 p-4">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">{{ t('setup.addTitle') }}</h2>
      <p class="mt-1 text-sm text-slate-600">{{ t('setup.addBody') }}</p>

      <div class="mt-3 flex gap-2">
        <button
          type="button"
          class="rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset"
          :class="mode === 'create' ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'"
          @click="mode = 'create'"
        >
          {{ t('setup.mode.create') }}
        </button>
        <button
          type="button"
          class="rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset"
          :class="mode === 'adopt' ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'"
          @click="mode = 'adopt'"
        >
          {{ t('setup.mode.adopt') }}
        </button>
      </div>

      <form class="mt-3 space-y-3" @submit.prevent="addMember">
        <div v-if="mode === 'adopt'">
          <label for="setup-uid" class="field-label">{{ t('setup.uid') }}</label>
          <input id="setup-uid" v-model="uid" type="text" required class="field-input" />
          <p class="mt-1.5 text-sm text-slate-500">{{ t('setup.uidHelp') }}</p>
        </div>
        <div>
          <label for="setup-email" class="field-label">{{ t('auth.email') }}</label>
          <input id="setup-email" v-model="email" type="email" required class="field-input" />
        </div>
        <div>
          <label for="setup-member-name" class="field-label">{{ t('settings.displayName') }}</label>
          <input id="setup-member-name" v-model="memberName" type="text" class="field-input" />
        </div>
        <div>
          <label for="setup-role" class="field-label">{{ t('settings.role') }}</label>
          <select id="setup-role" v-model="role" class="field-input">
            <option v-for="r in ASSIGNABLE_ROLES" :key="r" :value="r">{{ t(`role.${r}`) }}</option>
          </select>
        </div>
        <div>
          <label for="setup-team" class="field-label">
            {{ t('setup.team') }} <span class="text-slate-400">({{ t('common.optional') }})</span>
          </label>
          <input id="setup-team" v-model="teamId" type="text" class="field-input" />
        </div>

        <p v-if="memberError" class="field-error" role="alert">{{ memberError }}</p>

        <div v-if="created" class="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
          <p class="font-medium">{{ t('setup.createdTitle', { email: created.email }) }}</p>
          <p v-if="created.resetEmailSent === true" class="mt-1">{{ t('setup.resetSent') }}</p>
          <p v-else-if="created.resetEmailSent === false" class="mt-1">{{ t('setup.resetNotSent') }}</p>
        </div>

        <button type="submit" class="btn-primary w-full" :disabled="memberBusy">
          {{ memberBusy ? t('common.loading') : t('setup.addAction') }}
        </button>
      </form>

      <div class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
        <p class="font-medium">{{ t('setup.claimsTitle') }}</p>
        <p class="mt-0.5">{{ t('setup.claimsBody') }}</p>
        <code class="mt-1 block text-xs">npm run claims</code>
      </div>
    </section>

    <p v-else class="mt-5 text-sm text-slate-600">{{ t('setup.adminOnly') }}</p>
  </div>
</template>
