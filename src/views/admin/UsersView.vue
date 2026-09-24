<script setup>
import { computed } from 'vue'
import { collection, doc, query, updateDoc, where, serverTimestamp } from 'firebase/firestore'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { useCollection } from '@/composables/useCollection.js'
import { getDb } from '@/firebase/app.js'
import { ASSIGNABLE_ROLES } from '@/services/provisioning.service.js'
import { initialsFromName, avatarToneFromSeed } from '@/domain/avatar.js'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

const { items: users, loading } = useCollection(async () => {
  const db = await getDb()
  return query(collection(db, 'users'), where('orgId', '==', auth.orgId))
})

const sorted = computed(() =>
  [...users.value].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
)

const activeCount = computed(() => sorted.value.filter((user) => user.isActive).length)
const inactiveCount = computed(() => sorted.value.length - activeCount.value)

async function changeRole(user, role) {
  if (user.id === auth.uid) return
  try {
    const db = await getDb()
    await updateDoc(doc(db, 'users', user.id), { role, updatedAt: serverTimestamp(), updatedBy: auth.uid })
    ui.success(t('users.roleChanged', { name: user.displayName, role: t(`role.${role}`) }))
    ui.warn(t('users.claimsPending'))
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  }
}

async function toggleActive(user) {
  if (user.id === auth.uid) return
  const nextActive = !user.isActive
  try {
    const db = await getDb()
    await updateDoc(doc(db, 'users', user.id), {
      isActive: nextActive,
      updatedAt: serverTimestamp(),
      updatedBy: auth.uid,
    })
    ui.success(t(nextActive ? 'users.reactivated' : 'users.deactivated', { name: user.displayName }))
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  }
}
</script>

<template>
  <div class="page-shell">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 class="page-title">{{ t('nav.users') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ t('users.subtitle', { count: sorted.length }) }}</p>
      </div>
      <RouterLink :to="{ name: 'setup' }" class="btn-primary shrink-0 shadow-sm shadow-brand-700/20">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        {{ t('setup.addAction') }}
      </RouterLink>
    </div>

    <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div class="stat-chip text-slate-700">
        <span class="text-xl font-semibold tabular-nums leading-none text-slate-900">{{ sorted.length }}</span>
        <span class="mt-1.5 text-xs font-medium">{{ t('nav.users') }}</span>
      </div>
      <div class="stat-chip text-slate-700">
        <span class="text-xl font-semibold tabular-nums leading-none text-emerald-800">{{ activeCount }}</span>
        <span class="mt-1.5 text-xs font-medium">{{ t('users.active') }}</span>
      </div>
      <div class="stat-chip col-span-2 text-slate-700 sm:col-span-1">
        <span class="text-xl font-semibold tabular-nums leading-none text-slate-800">{{ inactiveCount }}</span>
        <span class="mt-1.5 text-xs font-medium">{{ t('users.inactive') }}</span>
      </div>
    </div>

    <div class="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-800 ring-inset">
      <p class="font-semibold">{{ t('users.claimsTitle') }}</p>
      <p class="mt-1 text-amber-950">{{ t('users.claimsBody') }}</p>
    </div>

    <div
      v-if="loading && !sorted.length"
      class="mt-4 grid gap-3 lg:grid-cols-2"
      aria-busy="true"
      aria-live="polite"
    >
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="n in 4" :key="n" class="card rounded-2xl p-4">
        <div class="flex gap-3">
          <div class="size-11 shrink-0 animate-pulse rounded-full bg-slate-200" />
          <div class="min-w-0 flex-1 space-y-2">
            <div class="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
            <div class="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
          </div>
        </div>
      </div>
    </div>

    <ul v-else class="mt-4 grid gap-3 lg:grid-cols-2">
      <li v-for="user in sorted" :key="user.id" class="card rounded-2xl p-4">
        <div class="flex items-start gap-3">
          <div
            class="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            :class="avatarToneFromSeed(user.displayName || user.id)"
            aria-hidden="true"
          >
            {{ initialsFromName(user.displayName) }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <p class="truncate font-semibold text-slate-900">{{ user.displayName }}</p>
              <span
                class="badge shrink-0"
                :class="user.isActive
                  ? 'bg-emerald-50 text-emerald-800 ring-emerald-700'
                  : 'bg-slate-100 text-slate-700 ring-slate-500'"
              >
                {{ user.isActive ? t('users.active') : t('users.inactive') }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-sm text-slate-600">{{ user.email }}</p>
            <p v-if="user.id === auth.uid" class="mt-1 text-xs font-medium text-slate-600">
              {{ t('users.you') }} · {{ t('users.cannotEditSelf') }}
            </p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <select
            class="field-input min-w-0 flex-1"
            :value="user.role"
            :disabled="user.id === auth.uid"
            :aria-label="t('settings.role')"
            @change="changeRole(user, $event.target.value)"
          >
            <option v-for="r in ASSIGNABLE_ROLES" :key="r" :value="r">{{ t(`role.${r}`) }}</option>
          </select>
          <button
            type="button"
            class="btn-secondary shrink-0 text-sm"
            :disabled="user.id === auth.uid"
            @click="toggleActive(user)"
          >
            {{ user.isActive ? t('users.deactivate') : t('users.reactivate') }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
