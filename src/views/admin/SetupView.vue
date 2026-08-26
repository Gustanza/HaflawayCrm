<script setup>
/**
 * Setup — the one screen that works before anybody has a role.
 *
 * It answers three questions depending on who is looking:
 *
 *   1. NO ROLE, NO PROFILE. Either a fresh registration whose organisation step failed
 *      partway (see RegisterView.vue's recovery case), or an account created directly in
 *      the Firebase Auth console. Either way, this offers the same "create your
 *      organisation" step RegisterView runs, and becomes its admin.
 *
 *   2. NO ROLE, BUT A PROFILE EXISTS. Provisioning has happened — self-registration just
 *      completed, or an admin invited this person — and the claim just has not landed on
 *      this token yet. Same "check again" as /no-access, offered here too so a person who
 *      followed that screen's link to Setup is not bounced straight back.
 *
 *   3. YOU ARE AN ADMIN. This creates everyone else — account, role, profile and the
 *      redacted name mirror — without anybody opening a terminal.
 *
 * WHAT IT CANNOT DO, and says so plainly: set a custom claim. That is Admin SDK only.
 * `firestore.rules` therefore reads the claim first and falls back to `users/{uid}`, so
 * people created here work immediately; `functions/index.js`'s `onCreate` trigger normally
 * converts the fallback into the zero-extra-read fast path within moments. `npm run claims`
 * remains a manual backstop, stated here rather than left as folklore.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import {
  ASSIGNABLE_ROLES,
  adoptExistingUser,
  createTeamMember,
  registerOrganization,
} from '@/services/provisioning.service.js'
import PageHeader from '@/components/layout/PageHeader.vue'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const isAdmin = computed(() => auth.role === 'admin')
const canRegisterOrg = computed(() => !auth.role && !auth.profile)
const stillSyncing = computed(() => !auth.role && Boolean(auth.profile))

/* ─────────────────────────────────────────────────────── create an organisation */

const orgCompanyName = ref('')
const orgDisplayName = ref('')
const registeringOrg = ref(false)

async function registerOrg() {
  if (registeringOrg.value || !orgCompanyName.value.trim()) return
  registeringOrg.value = true
  try {
    await registerOrganization({
      user: { uid: auth.uid, email: auth.user?.email },
      companyName: orgCompanyName.value,
      displayName: orgDisplayName.value,
    })
    ui.success(t('setup.orgCreated'))
    await auth.refreshClaims()
    router.replace({ name: 'work-queue' })
  } catch (error) {
    ui.error(error?.message ?? t('errors.write.generic'))
  } finally {
    registeringOrg.value = false
  }
}

/* ────────────────────────────────────────────────────────── check again */

const checkingAgain = ref(false)

async function checkAgain() {
  checkingAgain.value = true
  try {
    const refreshed = await auth.refreshClaims()
    if (refreshed && auth.canUseApp) {
      router.replace({ name: 'work-queue' })
    } else if (!refreshed) {
      ui.error(t(auth.errorKey ?? 'auth.error.network'))
    } else {
      ui.info(t('auth.noAccess.stillWaiting'))
    }
  } finally {
    checkingAgain.value = false
  }
}

/* ──────────────────────────────────────────────────────────── create a person */

const mode = ref('create') // 'create' | 'adopt'
const email = ref('')
const displayName = ref('')
const role = ref('agent')
const teamId = ref('')
const existingUid = ref('')
const saving = ref(false)
const lastCreated = ref(null)

const emailValid = computed(() => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()))
const canSubmit = computed(() =>
  saving.value
    ? false
    : mode.value === 'create'
      ? emailValid.value
      : existingUid.value.trim().length >= 20,
)

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  lastCreated.value = null

  const actor = { uid: auth.uid, orgId: auth.orgId }

  try {
    if (mode.value === 'create') {
      const result = await createTeamMember({
        email: email.value,
        displayName: displayName.value,
        role: role.value,
        teamId: teamId.value,
        actor,
      })
      lastCreated.value = {
        email: email.value.trim().toLowerCase(),
        role: role.value,
        resetEmailSent: result.resetEmailSent,
      }
    } else {
      await adoptExistingUser({
        uid: existingUid.value,
        email: email.value,
        displayName: displayName.value,
        role: role.value,
        teamId: teamId.value,
        actor,
      })
      lastCreated.value = { email: email.value.trim().toLowerCase(), role: role.value, adopted: true }
    }

    ui.success(t('setup.created'))
    email.value = ''
    displayName.value = ''
    existingUid.value = ''
  } catch (error) {
    const key = {
      'email-taken': 'setup.errorEmailTaken',
      'invalid-email': 'setup.errorInvalidEmail',
      'invalid-uid': 'setup.errorInvalidUid',
      'already-provisioned': 'setup.errorAlreadyProvisioned',
    }[error?.code]
    ui.error(key ? t(key) : (error?.message ?? t('errors.write.generic')))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader :title="$t('setup.title')" :subtitle="$t('setup.subtitle')" />

    <div class="px-4 sm:px-6 py-4 sm:py-6 max-w-2xl space-y-5">
      <!-- ── 1. Create an organisation ────────────────────────────────────── -->
      <section v-if="canRegisterOrg" class="card p-5 ring-2 ring-brand-500">
        <h2 class="font-semibold text-slate-900">{{ $t('setup.orgTitle') }}</h2>
        <p class="mt-1 text-sm text-slate-600">{{ $t('setup.orgBody') }}</p>

        <div class="mt-4">
          <label for="org-name" class="field-label">{{ $t('auth.register.companyName') }}</label>
          <input
            id="org-name"
            v-model="orgCompanyName"
            type="text"
            class="field-input"
            :placeholder="$t('auth.register.companyNamePlaceholder')"
          />
        </div>

        <div class="mt-4">
          <label for="org-display-name" class="field-label">{{ $t('settings.displayName') }}</label>
          <input
            id="org-display-name"
            v-model="orgDisplayName"
            type="text"
            class="field-input"
            :placeholder="auth.user?.email"
          />
        </div>

        <button
          type="button"
          class="btn-primary w-full mt-4"
          :disabled="registeringOrg || !orgCompanyName.trim()"
          @click="registerOrg"
        >
          {{ registeringOrg ? $t('common.loading') : $t('setup.orgAction') }}
        </button>
      </section>

      <!-- ── 2. Provisioned, but the claim has not landed on this token yet ── -->
      <section v-else-if="stillSyncing" class="card p-5">
        <h2 class="font-semibold text-slate-900">{{ $t('auth.noAccess.title') }}</h2>
        <p class="mt-1 text-sm text-slate-600">{{ $t('auth.noAccess.stillWaiting') }}</p>
        <button
          type="button"
          class="btn-primary w-full mt-4"
          :disabled="checkingAgain"
          @click="checkAgain"
        >
          {{ checkingAgain ? $t('common.loading') : $t('auth.noAccess.checkAgain') }}
        </button>
      </section>

      <!-- ── 3. Not an admin ─────────────────────────────────────────────── -->
      <section v-else-if="!isAdmin" class="card p-5">
        <h2 class="font-semibold text-slate-900">{{ $t('errors.forbidden') }}</h2>
        <p class="mt-1 text-sm text-slate-600">{{ $t('setup.adminOnly') }}</p>
      </section>

      <!-- ── 4. Admin: create everyone else ──────────────────────────────── -->
      <template v-else>
        <section class="card p-5">
          <h2 class="font-semibold text-slate-900">{{ $t('setup.addTitle') }}</h2>
          <p class="mt-1 mb-4 text-sm text-slate-600">{{ $t('setup.addBody') }}</p>

          <!-- Two routes in, because people arrive having already made the account. -->
          <div class="flex gap-2 mb-4">
            <button
              v-for="option in ['create', 'adopt']"
              :key="option"
              type="button"
              class="flex-1 rounded-lg px-3 text-sm font-medium ring-1 ring-inset ring-slate-400
                     bg-white text-slate-700 data-[on=true]:bg-brand-600 data-[on=true]:text-white
                     data-[on=true]:ring-brand-600"
              style="min-height: var(--spacing-touch)"
              :data-on="mode === option"
              :aria-pressed="mode === option"
              @click="mode = option"
            >
              {{ $t(`setup.mode.${option}`) }}
            </button>
          </div>

          <form class="space-y-4" novalidate @submit.prevent="submit">
            <div v-if="mode === 'adopt'">
              <label for="s-uid" class="field-label">{{ $t('setup.uid') }}</label>
              <input
                id="s-uid"
                v-model="existingUid"
                type="text"
                class="field-input font-mono text-sm"
                autocomplete="off"
                spellcheck="false"
                placeholder="waZBarALRaUc6ZySJ01Mxs7olUaC"
              />
              <p class="mt-1.5 text-xs text-slate-500">{{ $t('setup.uidHelp') }}</p>
            </div>

            <div>
              <label for="s-email" class="field-label">
                {{ $t('auth.email') }}
                <span v-if="mode === 'adopt'" class="font-normal text-slate-400">
                  · {{ $t('common.optional') }}
                </span>
              </label>
              <input
                id="s-email"
                v-model="email"
                type="email"
                class="field-input"
                autocomplete="off"
                inputmode="email"
                autocapitalize="none"
                :placeholder="$t('auth.emailPlaceholder')"
                :aria-invalid="mode === 'create' && email.length > 3 && !emailValid"
              />
            </div>

            <div>
              <label for="s-name" class="field-label">{{ $t('settings.displayName') }}</label>
              <input id="s-name" v-model="displayName" type="text" class="field-input" />
            </div>

            <fieldset>
              <legend class="field-label">{{ $t('settings.role') }}</legend>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="option in ASSIGNABLE_ROLES"
                  :key="option"
                  type="button"
                  class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                         bg-white text-slate-700 data-[on=true]:bg-brand-600
                         data-[on=true]:text-white data-[on=true]:ring-brand-600"
                  style="min-height: var(--spacing-touch)"
                  :data-on="role === option"
                  :aria-pressed="role === option"
                  @click="role = option"
                >
                  {{ $t(`role.${option}`) }}
                </button>
              </div>
            </fieldset>

            <div>
              <label for="s-team" class="field-label">
                {{ $t('setup.team') }}
                <span class="font-normal text-slate-400">· {{ $t('common.optional') }}</span>
              </label>
              <input id="s-team" v-model="teamId" type="text" class="field-input" placeholder="team-dar" />
            </div>

            <button type="submit" class="btn-primary w-full" :disabled="!canSubmit">
              {{ saving ? $t('common.loading') : $t('setup.addAction') }}
            </button>
          </form>
        </section>

        <!-- What happened, and what is still outstanding. -->
        <section v-if="lastCreated" class="card p-4 ring-1 ring-emerald-300 bg-emerald-50/50">
          <p class="text-sm font-medium text-emerald-900">
            {{ $t('setup.createdTitle', { email: lastCreated.email }) }}
          </p>
          <p v-if="lastCreated.resetEmailSent" class="mt-1 text-sm text-emerald-800">
            {{ $t('setup.resetSent') }}
          </p>
          <p v-else-if="!lastCreated.adopted" class="mt-1 text-sm text-amber-800">
            {{ $t('setup.resetNotSent') }}
          </p>
        </section>

        <!-- The honest limitation, stated where it is relevant rather than in a wiki. -->
        <section class="card p-4 bg-slate-50">
          <h2 class="text-sm font-medium text-slate-800">{{ $t('setup.claimsTitle') }}</h2>
          <p class="mt-1 text-sm text-slate-600">{{ $t('setup.claimsBody') }}</p>
          <code class="mt-2 block text-xs bg-slate-100 rounded px-2 py-1.5 text-slate-800">
            npm run claims
          </code>
        </section>
      </template>
    </div>
  </div>
</template>
