<script setup>
/**
 * Users — TODO.md §12 screen 16, admin only.
 *
 * ⚠️ THE IMPORTANT THING ON THIS SCREEN: editing the `users/{uid}` document does NOT
 * grant access. `firestore.rules` authorises from the Auth CUSTOM CLAIM, and only
 * `scripts/syncClaims.js` writes claims. So a role changed here is pending until an
 * administrator runs that script — and the UI says so in as many words, because the
 * alternative is someone changing a role, seeing it in the list, and assuming it took
 * effect (§7.1).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { collection, doc, query, where, updateDoc, serverTimestamp, orderBy } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { useCollection } from '@/composables/useCollection.js'
import { ROLES } from '@/stores/auth.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import { usePagination, PAGE_SIZES } from '@/composables/usePagination.js'
import PaginationBar from '@/components/ui/PaginationBar.vue'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const { items, loading, loaded, error, load } = useCollection(async () => {
  const db = await getDb()
  return query(
    collection(db, 'users'),
    where('orgId', '==', auth.orgId),
    orderBy('displayName', 'asc'),
  )
})

const pending = ref(new Set())

const sorted = computed(() =>
  [...items.value].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return (a.displayName ?? '').localeCompare(b.displayName ?? '')
  }),
)

const pager = usePagination(sorted, { pageSize: 25 })

async function patch(user, changes, message) {
  pending.value = new Set(pending.value).add(user.id)
  try {
    const db = await getDb()
    await updateDoc(doc(db, 'users', user.id), {
      ...changes,
      updatedAt: serverTimestamp(),
      updatedBy: auth.uid,
    })
    ui.success(message)
    // The claim has NOT changed yet. Say so plainly rather than let it look done.
    ui.warn(t('users.claimsPending'), { timeout: 8000 })
    load()
  } catch {
    ui.error(t('errors.write.permissionDenied'))
  } finally {
    const next = new Set(pending.value)
    next.delete(user.id)
    pending.value = next
  }
}

const setRole = (user, role) =>
  patch(user, { role }, t('users.roleChanged', { name: user.displayName, role: t(`role.${role}`) }))

const toggleActive = (user) =>
  patch(
    user,
    { isActive: !user.isActive },
    user.isActive
      ? t('users.deactivated', { name: user.displayName })
      : t('users.reactivated', { name: user.displayName }),
  )
</script>

<template>
  <div>
    <PageHeader
      :title="$t('nav.users')"
      :subtitle="$t('users.subtitle', { count: items.length })"
    />

    <div class="px-4 sm:px-6 py-4 sm:py-6 max-w-3xl">

    <!-- Not a footnote: the single most misleading thing this screen could do is imply a
         role change is live when the claim has not been synced. -->
    <div class="mb-4 rounded-lg bg-amber-50 ring-1 ring-amber-300 p-3">
      <p class="text-sm font-medium text-amber-900">{{ $t('users.claimsTitle') }}</p>
      <p class="mt-1 text-sm text-amber-800">{{ $t('users.claimsBody') }}</p>
      <code class="mt-2 block text-xs bg-amber-100 rounded px-2 py-1 text-amber-900">
        npm run claims
      </code>
    </div>

    <LoadingRows v-if="loading && !loaded" :rows="5" />

    <div v-else-if="error" class="card p-6 text-center">
      <p class="text-sm text-slate-700">{{ $t('errors.loadFailed') }}</p>
      <button type="button" class="btn-secondary mt-4" @click="load">{{ $t('common.retry') }}</button>
    </div>

    <template v-else>
    <ul class="space-y-2">
      <li
        v-for="user in pager.items.value"
        :key="user.id"
        class="card p-4"
        :class="user.isActive === false ? 'opacity-60' : ''"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-medium text-slate-900 truncate">{{ user.displayName }}</p>
            <p class="text-sm text-slate-500 truncate">{{ user.email }}</p>
            <p v-if="user.teamId" class="text-xs text-slate-400">{{ user.teamId }}</p>
          </div>
          <span
            v-if="user.isActive === false"
            class="badge bg-slate-200 text-slate-600 ring-slate-300 shrink-0"
          >
            {{ $t('users.inactive') }}
          </span>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <button
            v-for="role in ROLES"
            :key="role"
            type="button"
            class="rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ring-slate-400
                   bg-white text-slate-700 data-[on=true]:bg-brand-600 data-[on=true]:text-white
                   data-[on=true]:ring-brand-600 disabled:opacity-50"
            :data-on="user.role === role"
            :disabled="pending.has(user.id) || user.id === auth.uid"
            @click="setRole(user, role)"
          >
            {{ $t(`role.${role}`) }}
          </button>
        </div>

        <button
          type="button"
          class="mt-2 text-sm font-medium"
          :class="user.isActive === false ? 'text-emerald-700' : 'text-rose-700'"
          :disabled="pending.has(user.id) || user.id === auth.uid"
          @click="toggleActive(user)"
        >
          {{ user.isActive === false ? $t('users.reactivate') : $t('users.deactivate') }}
        </button>

        <p v-if="user.id === auth.uid" class="mt-1 text-xs text-slate-400">
          {{ $t('users.cannotEditSelf') }}
        </p>
      </li>
    </ul>

    <PaginationBar
      :page="pager.page.value"
      :page-count="pager.pageCount.value"
      :from="pager.from.value"
      :to="pager.to.value"
      :total="pager.total.value"
      :per-page="pager.perPage.value"
      :pages="pager.windowFor(2)"
      :sizes="PAGE_SIZES"
      :has-prev="pager.hasPrev.value"
      :has-next="pager.hasNext.value"
      @prev="pager.prev"
      @next="pager.next"
      @go="pager.go"
      @per-page="pager.setPerPage"
    />
    </template>
    </div>
  </div>
</template>
