<script setup>
import { computed } from 'vue'
import { collection, doc, query, updateDoc, where, serverTimestamp } from 'firebase/firestore'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { useCollection } from '@/composables/useCollection.js'
import { getDb } from '@/firebase/app.js'
import { ASSIGNABLE_ROLES } from '@/services/provisioning.service.js'

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
  <div class="mx-auto max-w-2xl px-4 py-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">{{ t('nav.users') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ t('users.subtitle', { count: sorted.length }) }}</p>
      </div>
      <RouterLink :to="{ name: 'setup' }" class="btn-primary shrink-0">
        {{ t('setup.addAction') }}
      </RouterLink>
    </div>

    <div class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
      <p class="font-medium">{{ t('users.claimsTitle') }}</p>
      <p class="mt-0.5">{{ t('users.claimsBody') }}</p>
    </div>

    <div v-if="loading && !sorted.length" class="mt-8 text-center text-sm text-slate-500">
      {{ t('common.loading') }}
    </div>

    <ul v-else class="mt-4 space-y-2">
      <li v-for="user in sorted" :key="user.id" class="card p-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-medium text-slate-900">{{ user.displayName }}</p>
            <p class="text-sm text-slate-600">{{ user.email }}</p>
          </div>
          <span
            class="badge"
            :class="user.isActive
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-300'
              : 'bg-slate-100 text-slate-600 ring-slate-300'"
          >
            {{ user.isActive ? t('common.yes') : t('users.inactive') }}
          </span>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center gap-2">
          <select
            class="field-input w-auto"
            style="min-height: 2.25rem"
            :value="user.role"
            :disabled="user.id === auth.uid"
            @change="changeRole(user, $event.target.value)"
          >
            <option v-for="r in ASSIGNABLE_ROLES" :key="r" :value="r">{{ t(`role.${r}`) }}</option>
          </select>
          <button
            type="button"
            class="btn-secondary text-sm"
            :disabled="user.id === auth.uid"
            @click="toggleActive(user)"
          >
            {{ user.isActive ? t('users.deactivate') : t('users.reactivate') }}
          </button>
          <span v-if="user.id === auth.uid" class="text-xs text-slate-500">{{ t('users.cannotEditSelf') }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>
