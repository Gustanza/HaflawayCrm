# Haflaway CRM

Lead-to-cash system for Haflaway — digital invitations, eCards, event reminders and RSVP.
Built for ~50 field and sales staff working their own pipelines across Tanzania.

**[TODO.md](TODO.md) is the specification.** It carries the domain model, the exact CAC
formulas, the security model and the phase-by-phase build queue. Read it before changing
anything non-trivial; code that contradicts it is a defect.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in from the Firebase console → Project settings
npm run dev:emulators           # terminal 1 — Auth, Firestore, Storage + emulator UI
npm run dev                     # terminal 2 — Vite dev server
```

The dev build **always** talks to the emulators (`src/firebase/app.js`), so production data
is never touched from a development machine. Set `VITE_USE_EMULATORS=false` to override — do
that deliberately, never by habit.

Seed a realistic organisation (14 users, 2 teams, 5 campaigns, 3 months of expenses, leads
with timelines and open tasks). The emulators must already be running:

```bash
npm run seed              # against a running emulator; data persists via its export-on-exit
npm run seed:standalone   # spins up its own emulator — for CI, does not persist
```

Then sign in as any of `admin@haflaway.com`, `manager.dar@haflaway.com`,
`agent1@haflaway.com`, `finance@haflaway.com` — password `haflaway123` (emulator only).
`exstaff@haflaway.com` is deliberately deactivated so the no-access path stays testable.

**[TEST-ACCOUNTS.md](TEST-ACCOUNTS.md)** lists all 14 seeded accounts, the full role matrix,
and what to check with each one.
**[DEPLOY.md](DEPLOY.md)** covers going to production — including creating the first admin,
which cannot be done from inside the app.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run dev:emulators` | Emulator Suite, importing/exporting `.emulator-data` so seeded state survives a restart |
| `npm run build` | Production build |
| `npm test` | Unit tests (pure domain logic) |
| `npm run test:rules` | Security-rules tests against the Firestore emulator |
| `npm run test:all` | Unit + rules suites |
| `npm run test:integration` | Live sign-in against running emulators (start them + seed first) |
| `npm run test:views` | Mounts every view — with data, with no data, as every role |
| `npm run seed` | Seed a running emulator. **Refuses to run against production.** |
| `npm run seed:standalone` | Seed inside a throwaway emulator (CI) |
| `npm run claims` | Sync Auth custom claims from `users/{uid}` documents |
| `npm run bootstrap:admin` | Create the first admin — the one thing the app cannot do for itself |
| `npm run deploy:rules` | Deploy `firestore.rules`, indexes and `storage.rules` |
| `npm run deploy` | Rules first, then hosting |
| `npm run free:ports` | Kill stale emulator processes holding ports (see Troubleshooting) |
| `npm run smoke` | Start a fresh dev server and fetch index, entry, CSS, an SFC and a domain module |
| `npm run check:bundle` | Assert the login-path bundle against the 250 KB budget (runs inside `build`) |

---

## Architecture in one screen

```
src/
  domain/      PURE functions. No Firebase imports, ever. 100% unit-tested.
               periods · money · phone · stages · (scoring, cadence, metrics to come)
  firebase/    SDK initialisation, persistent offline cache, emulator wiring
  stores/      Pinia — auth (claims + profile), ui (toasts, connectivity)
  router/      Routes and guards
  services/    Firestore I/O — thin, transactional
  components/  layout/ · ui/ · leads/
  views/       One folder per area
  locales/     sw.json (default) · en.json
tests/
  unit/        Domain logic. Runs with TZ pinned to America/New_York — see below.
  rules/       firestore.rules, exercised through the emulator
scripts/       seed · syncClaims · free-ports
```

**The one hard rule:** `src/domain/` must not import Firebase. It stays pure, fast to test,
and portable if we ever leave Firestore.

---

## Things that will bite you

**Authorisation comes from custom claims, not from the user document.** `firestore.rules`
reads `request.auth.token.role` / `.teamId` / `.orgId` / `.active`. A rule that fetched
`users/{uid}` would bill a document read on every operation for all 50 staff. The claim is
the authority; the document is the profile the UI renders. `scripts/syncClaims.js` is the
only sanctioned way to grant a role — editing the document alone changes nothing.

**Development machines here run `Africa/Nairobi`, which shares Dar es Salaam's UTC+3
offset.** That hides every timezone bug. The unit suite is therefore pinned to
`America/New_York` in `vite.config.js`. Do not "simplify" that away — it is the only reason
a 23-hour "org day" gets caught. See `tests/unit/regressions.test.js`.

**Money is integer minor units, always.** Never floats, never formatted strings in storage.
Rounding is half **away from zero**, because under the append-only ledger (TODO.md P4) a
correction is a new *negative* entry, and asymmetric rounding leaves stranded senti behind
every reversal.

**Activities and financial entries are append-only.** No update, no delete — a correction is
a new document pointing at the one it corrects. This is what makes a commission dispute
resolvable. The rules enforce it; do not work around them.

**Security rules are NOT filters — every list query must carry its constraints.** On a
`get`, the rule sees the document. On a `list`, it must be provable from the `where()`
clauses before anything is read, so every field the rule touches must be constrained. An
agent querying `where('ownerId','==',me)` is *denied*, because the rule also reads `orgId`.
Use the builders in `src/services/queries.js`; they encode the verified matrix
(agent: `orgId + ownerId` · manager: `orgId + teamId` · finance/admin/viewer: `orgId`).
`tests/rules/list.rules.test.js` pins it.

**A view that compiles can still render nothing.** Vue reports a render error to
`console.error` rather than throwing out of `mount()`, and the dev server happily returns
HTTP 200 for a component whose `setup()` threw. `npm run test:views` mounts every screen —
populated, empty, and as each of the five roles — and fails on any logged render error. Run
it after touching a view; a `curl` compile check will not catch this class of bug.

**Phone numbers are the deduplication key.** Every spelling of one number must normalise to
the same E.164 string, and two *different* numbers must never collide. `src/domain/phone.js`
carries the hard-won cases; add to its tests before you touch it.

---

## Troubleshooting

**"Could not start Firestore Emulator, port taken"** — the emulator does not exit cleanly on
Java 26; its rules-runtime child throws on shutdown and the JVM keeps port 8080. Every
emulator script already runs `scripts/free-ports.mjs` first. Run `npm run free:ports` by hand
if you hit it another way.

**Signing in lands on "your account is not set up yet"** — the account exists in Auth but has
no role claim. Run `npm run claims`, or grant one directly:

```bash
node scripts/syncClaims.js --emulator --email=you@haflaway.com --role=admin
```

**"Failed to load PostCSS config … Expected double-quoted property name in JSON"** — the
dev server is stale, not the code. Vite resolves the PostCSS config once and caches the
result, including a failure. Editing `package.json` while `vite dev` is watching can let it
read a half-written file (truncate-then-write is not atomic), and it then keeps serving that
error until restarted. **Fix: stop the dev server and start it again.** If you script an
edit to `package.json`, write to a temp file and `rename()` it so a watcher never sees a
partial file.

**A dev-server check passed but the browser is broken** — run `npm run smoke` rather than
curling by hand. It starts a server on a **strict** port (so it cannot silently attach to
someone else's stale one) and fetches the CSS and an SFC, not just `index.html`. Vite serves
its error overlay with HTTP 200, so a status code alone proves nothing.

**Rules tests fail after editing `firestore.rules`** — check `tests/unit/stages.test.js`
first. It parses the rules file and asserts the pipeline transitions there match
`src/domain/stages.js`. A failure means the client and the server now disagree about which
stage moves are legal.
#   H a f l a w a y C r m  
 