/**
 * Dev-server smoke test.
 *
 * Exists because a hand-rolled check missed a real breakage twice over:
 *
 *   1. It fetched `/` and `/src/main.js` but never the CSS — and the failure was in the
 *      CSS pipeline, so the app was broken in the browser while the check said "HTTP 200".
 *   2. It started Vite WITHOUT --strictPort. Port 5173 was already taken by a stale server,
 *      Vite quietly moved to 5174, and the curl hit the OLD server. The test was measuring
 *      a process it had not started.
 *
 * So: strict port, fresh process, and fetch every asset class the browser actually needs.
 *
 * Usage: npm run smoke
 */

import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.env.SMOKE_PORT ?? 5177)
const BASE = `http://localhost:${PORT}`

/** Each probe is a URL plus a predicate on the response body. */
const PROBES = [
  {
    path: '/',
    name: 'index.html',
    check: (body) => body.includes('<div id="app">') && body.includes('/src/main.js'),
  },
  {
    path: '/src/main.js',
    name: 'entry module',
    check: (body) => body.includes('createApp'),
  },
  {
    // The one the old check skipped. Tailwind compiles here; a PostCSS or @apply failure
    // shows up as a Vite error page with HTTP 200, so checking the status is not enough.
    path: '/src/style.css',
    name: 'stylesheet (Tailwind compiles)',
    check: (body) => body.includes('tailwindcss') && !/Failed to load|SyntaxError|\[plugin:/.test(body),
  },
  {
    path: '/src/App.vue',
    name: 'root component (SFC compiles)',
    check: (body) => !/Failed to|SyntaxError|\[plugin:/.test(body),
  },
  {
    path: '/src/domain/stages.js',
    name: 'domain module',
    check: (body) => body.includes('TRANSITIONS'),
  },
]

console.log(`Starting a fresh dev server on ${PORT} (strict)…`)

const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
)

let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

/**
 * On Windows the server is spawned through a shell, so `kill()` reaches the shell and not
 * the Vite process underneath — the node process then hangs forever waiting on a child
 * that is still listening. Kill the whole tree.
 */
function stop() {
  try {
    if (process.platform === 'win32' && server.pid) {
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
    } else {
      server.kill('SIGTERM')
    }
  } catch {
    /* already gone */
  }
}

async function waitForReady(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (/Port \d+ is in use/i.test(serverLog)) {
      throw new Error(
        `Port ${PORT} is already in use. Something else is running there — this test refuses ` +
          'to measure a server it did not start. Stop it, or set SMOKE_PORT.',
      )
    }
    try {
      const res = await fetch(BASE + '/')
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(400)
  }
  throw new Error(`Dev server did not become ready within ${timeoutMs}ms.\n${serverLog}`)
}

let failures = 0

try {
  await waitForReady()
  console.log('Server up. Probing:\n')

  for (const probe of PROBES) {
    let status = '?'
    let ok = false
    let detail = ''
    try {
      const res = await fetch(BASE + probe.path)
      status = res.status
      const body = await res.text()
      ok = res.ok && probe.check(body)
      if (!ok) {
        // Vite serves its error overlay with HTTP 200, so surface the body.
        detail = body.slice(0, 300).replace(/\s+/g, ' ')
      }
    } catch (error) {
      detail = error.message
    }

    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${String(status).padEnd(4)} ${probe.name}`)
    if (!ok) {
      failures += 1
      console.log(`        ${detail}`)
    }
  }
} catch (error) {
  console.error('\n' + error.message)
  failures += 1
} finally {
  stop()
}

console.log('')
if (failures) {
  console.error(`Smoke test FAILED — ${failures} probe(s).`)
  process.exit(1)
}
console.log('Smoke test passed.')
// Explicit: any stray handle from the spawned server would otherwise hold the process open.
process.exit(0)
