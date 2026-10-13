import { store, nameOf } from './store.js'
import { OBJECTS, RELATABLE, NAV_OBJECTS, recordName } from './meta/objects.js'

// Secondary text shown next to a search hit.
function detailOf(object, r) {
  if (object === 'leads') return r.company
  if (object === 'contacts' || object === 'opportunities') return nameOf('accounts', r.accountId)
  if (object === 'accounts') return r.city
  if (object === 'tasks') return r.dueDate
  return ''
}

// Ranks prefix matches on the name above other substring matches.
export function searchAll(query, objects = NAV_OBJECTS) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits = []
  for (const object of objects) {
    const meta = OBJECTS[object]
    for (const r of store[object]) {
      const name = recordName(object, r)
      const lname = name.toLowerCase()
      let score = 0
      if (lname.startsWith(q)) score = 3
      else if (lname.split(/\s+/).some((w) => w.startsWith(q))) score = 2
      else if (lname.includes(q) || meta.searchFields.some((f) => String(r[f] ?? '').toLowerCase().includes(q))) score = 1
      if (score) hits.push({ object, record: r, name, detail: detailOf(object, r), score })
    }
  }
  return hits.sort((a, b) => b.score - a.score || (b.record.updatedAt || 0) - (a.record.updatedAt || 0))
}

export function searchRelatable(query) {
  return searchAll(query, RELATABLE)
}
