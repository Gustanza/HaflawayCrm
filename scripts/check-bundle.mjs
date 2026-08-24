/**
 * Assert the first-paint bundle budget against the BUILT OUTPUT.
 *
 * Why this exists: it is very easy to fool yourself here. Reading `await import()` in the
 * source proves nothing — a chunking config can hoist the dynamically-imported module back
 * into the static graph, and it did. Reading the `modulepreload` list in index.html proves
 * nothing either: a chunk that is merely *not preloaded* is still *required*, and is fetched
 * one round trip later.
 *
 * So this walks the real static import graph from the entry module, transitively, and
 * gzips every file that a browser must have before the login form can render.
 *
 * TODO.md §15: under 250 KB gzipped. §13: the deployment device is a low-end Android phone
 * on throttled 3G.
 *
 * Usage: node scripts/check-bundle.mjs [--budget=250]
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')),
)
const BUDGET_KB = Number(args.budget ?? 250)

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No dist/ — run `npm run build` first.')
  process.exit(1)
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length

/** Static `import ... from "./x.js"` and `export ... from "./x.js"` — NOT `import(...)`. */
function staticDeps(file) {
  const code = readFileSync(file, 'utf8')
  const deps = new Set()
  // Matches: from"./x.js"  from './x.js'  import"./x.js"
  for (const m of code.matchAll(/(?:from|import)\s*["'](\.[^"']+\.js)["']/g)) {
    const resolved = resolve(dirname(file), m[1])
    if (existsSync(resolved)) deps.add(resolved)
  }
  return deps
}

// Entry points the HTML itself demands: the module script, plus every stylesheet.
const entries = []
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) entries.push(m[1])
const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1])

const required = new Set()
const queue = entries.map((href) => join(DIST, href.replace(/^\//, '')))

while (queue.length) {
  const file = queue.pop()
  if (!file || required.has(file) || !existsSync(file)) continue
  required.add(file)
  for (const dep of staticDeps(file)) queue.push(dep)
}

for (const href of styles) {
  const file = join(DIST, href.replace(/^\//, ''))
  if (existsSync(file)) required.add(file)
}

/**
 * The static graph alone understates it. `main.js` boots via
 * `await Promise.all([import('./App.vue'), import('./router/index.js'), ...])`, and the
 * login form cannot paint until those resolve — Vite declares them in the entry chunk's
 * `__vite__mapDeps` table and preloads them. So the honest number is: the static graph,
 * PLUS every chunk that table names, PLUS the login route, PLUS all of their static deps.
 *
 * Measuring only the modulepreload hints in index.html is what previously made a
 * 266 KB bundle look like 66 KB.
 */
function addWithDeps(file) {
  const queue = [file]
  while (queue.length) {
    const f = queue.pop()
    if (!f || required.has(f) || !existsSync(f)) continue
    required.add(f)
    for (const dep of staticDeps(f)) queue.push(dep)
  }
}

for (const entry of entries) {
  const file = join(DIST, entry.replace(/^\//, ''))
  if (!existsSync(file)) continue
  const code = readFileSync(file, 'utf8')
  const table = code.match(/__vite__mapDeps=\(i,m=__vite__mapDeps,d=\(m\.f\|\|\(m\.f=\[([^\]]*)\]/)
  if (!table) continue
  for (const m of table[1].matchAll(/"([^"]+)"/g)) {
    addWithDeps(join(DIST, m[1]))
  }
}

// The login route itself — the first screen any user sees.
for (const f of readdirSync(join(DIST, 'assets'))) {
  if (/^LoginView-.*\.js$/.test(f)) addWithDeps(join(DIST, 'assets', f))
}

const rows = [...required]
  .map((file) => ({ file: file.slice(DIST.length + 1).replace(/\\/g, '/'), bytes: gz(file) }))
  .sort((a, b) => b.bytes - a.bytes)

const total = rows.reduce((sum, r) => sum + r.bytes, 0)
const budget = BUDGET_KB * 1024

console.log('Login-path bundle — everything needed to paint the sign-in form, gzipped:\n')
for (const r of rows) {
  console.log(`  ${String((r.bytes / 1024).toFixed(1)).padStart(7)} KB  ${r.file}`)
}
console.log('  ' + '-'.repeat(60))
console.log(`  ${String((total / 1024).toFixed(1)).padStart(7)} KB  TOTAL`)
console.log(`  ${String(BUDGET_KB.toFixed(1)).padStart(7)} KB  BUDGET (TODO.md §15)\n`)

// Firestore must NOT be on this path: the signed-out routes never touch a database.
const firestoreOnPath = rows.find((r) => /firestore/i.test(r.file))
if (firestoreOnPath) {
  console.error(
    `FAIL: ${firestoreOnPath.file} is a STATIC dependency of the entry.\n` +
      '      The Firestore SDK must load only after sign-in (src/firebase/app.js getDb()).\n' +
      '      An `await import()` in the source is not enough — check the chunking config.',
  )
  process.exit(1)
}

if (total > budget) {
  console.error(`FAIL: over budget by ${((total - budget) / 1024).toFixed(1)} KB.`)
  process.exit(1)
}

console.log(`PASS: ${((budget - total) / 1024).toFixed(1)} KB of headroom.`)
