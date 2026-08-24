/**
 * Resolve user ids to display names.
 *
 * Reads the REDACTED `usersPublic` mirror, never `users`. The full user document carries
 * targets, commission rate, phone and FCM tokens, and Firestore cannot project fields —
 * so reading it just to render a name would hand every viewer a colleague's pay data
 * (TODO.md §7.1, B14). The mirror holds display name and photo only, and every active
 * member of the org may read it.
 *
 * Without this, screens that group by `ownerId` print a raw uid, which is unreadable to
 * the manager the screen is written for.
 */

import { computed } from 'vue'
import { collection, query, where } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { useCollection } from '@/composables/useCollection.js'

export function useUserNames(orgId) {
  const { items, loading, loaded } = useCollection(async () => {
    const org = typeof orgId === 'function' ? orgId() : orgId?.value ?? orgId
    if (!org) return null
    return query(collection(await getDb(), 'usersPublic'), where('orgId', '==', org))
  })

  const byId = computed(() => new Map(items.value.map((u) => [u.id, u.displayName])))

  /**
   * Fall back to the uid rather than to an empty cell: an unresolved id is still an
   * identifier someone can search for, whereas a blank row looks like missing data.
   */
  function nameFor(uid) {
    if (!uid) return ''
    return byId.value.get(uid) ?? uid
  }

  return { names: byId, nameFor, loading, loaded }
}
