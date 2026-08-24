/**
 * Free the Firebase emulator ports before a run.
 *
 * The Firestore emulator does not always exit cleanly (on Java 26 its rules-runtime
 * child throws on shutdown and the JVM lingers), which leaves port 8080 held and makes
 * the next `emulators:exec` fail with "port taken". Rather than have every developer
 * hunt the PID by hand, we clear the ports first.
 *
 * Only processes actually listening on an emulator port are touched.
 *
 * Usage: node scripts/free-ports.mjs [port ...]
 */

import { execSync } from 'node:child_process'

const DEFAULT_PORTS = [9099, 8080, 9199, 5000, 4000, 4400, 4500, 9150]
const ports = process.argv.slice(2).map(Number).filter(Boolean)
const targets = ports.length ? ports : DEFAULT_PORTS

const isWindows = process.platform === 'win32'

function pidsOnPort(port) {
  try {
    if (isWindows) {
      // NOT `-p TCP`: that filters to IPv4 only, and Vite binds `localhost`, which
      // resolves to ::1 on Windows — so an IPv6-only listener was invisible and this
      // script cheerfully reported "already free" while the port was held. The Firestore
      // emulator hid the bug by binding 127.0.0.1. Plain `netstat -ano` lists both.
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      return [
        ...new Set(
          out
            .split(/\r?\n/)
            .filter((line) => /LISTENING/i.test(line))
            // Match the LOCAL address column only, so a remote port never matches:
            // "  TCP    [::1]:5173    [::]:0    LISTENING    18480"
            .filter((line) => {
              const local = line.trim().split(/\s+/)[1] ?? ''
              return local.endsWith(`:${port}`)
            })
            .map((line) => line.trim().split(/\s+/).pop())
            .filter((pid) => pid && pid !== '0'),
        ),
      ]
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.split(/\s+/).filter(Boolean)
  } catch {
    return [] // nothing listening
  }
}

function kill(pid) {
  try {
    execSync(isWindows ? `taskkill /PID ${pid} /F /T` : `kill -9 ${pid}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let freed = 0
for (const port of targets) {
  for (const pid of pidsOnPort(port)) {
    if (kill(pid)) {
      console.log(`  freed port ${port} (pid ${pid})`)
      freed += 1
    } else {
      console.warn(`  could not free port ${port} (pid ${pid}) — kill it manually`)
    }
  }
}

console.log(freed ? `Freed ${freed} stale emulator process(es).` : 'Emulator ports already free.')
